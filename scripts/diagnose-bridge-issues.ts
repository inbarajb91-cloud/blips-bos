/**
 * Diagnose three live Bridge issues reported post-Supabase-migration:
 *   1. Pending counter shows 70+ but visible collections only sum to a few
 *   2. Realtime not streaming — Bridge progress only updates on manual refresh
 *   3. Layout shift on /engine-room initial render
 *
 * Issues 1+2 are queryable from the DB. Issue 3 is purely a client/render
 * problem and needs browser-level inspection (not this script).
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

const envFile = readFileSync(
  "/Users/inbaraj/blips-bos/.env.local",
  "utf-8",
);
for (const line of envFile.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  if (!process.env[k]) process.env[k] = v;
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
  });
  try {
    const [o] = (await sql`SELECT id FROM orgs WHERE slug='blips'`) as Array<{
      id: string;
    }>;
    const orgId = o.id;
    console.log(`org_id = ${orgId}\n`);

    // ─── 1. PENDING_REVIEW candidates by collection + collection status ─
    console.log("=".repeat(70));
    console.log("1. PENDING counter breakdown");
    console.log("=".repeat(70));
    const all = (await sql`
      SELECT
        bc.collection_id,
        c.name AS collection_name,
        c.status AS collection_status,
        COUNT(*)::int AS candidate_count
      FROM bunker_candidates bc
      LEFT JOIN collections c ON c.id = bc.collection_id
      WHERE bc.org_id = ${orgId} AND bc.status = 'PENDING_REVIEW'
      GROUP BY bc.collection_id, c.name, c.status
      ORDER BY candidate_count DESC
    `) as Array<{
      collection_id: string | null;
      collection_name: string | null;
      collection_status: string | null;
      candidate_count: number;
    }>;
    let total = 0;
    let hiddenFromUI = 0;
    for (const r of all) {
      const hidden =
        r.collection_status === "archived" ||
        r.collection_status === null ||
        r.collection_id === null;
      total += r.candidate_count;
      if (hidden) hiddenFromUI += r.candidate_count;
      console.log(
        `  ${r.candidate_count.toString().padStart(4)} → ${(r.collection_status ?? "ORPHAN").padEnd(10)} ${r.collection_name ?? "(no collection)"}${hidden ? "  ← hidden from Bridge UI" : ""}`,
      );
    }
    console.log(
      `\n  TOTAL pending: ${total} (visible-collection: ${total - hiddenFromUI}, hidden/orphan: ${hiddenFromUI})`,
    );

    // ─── 2. Realtime publication & schema setup ───────────────────────
    console.log("\n" + "=".repeat(70));
    console.log("2. Realtime configuration");
    console.log("=".repeat(70));
    const pub = (await sql`
      SELECT tablename FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' ORDER BY tablename
    `) as Array<{ tablename: string }>;
    console.log(`\n  supabase_realtime publication (${pub.length} tables):`);
    for (const r of pub) console.log(`    - ${r.tablename}`);

    // RLS policies on realtime.messages — this is the gate for client subscriptions
    let rtPolicies: Array<{ tablename: string; policyname: string }> = [];
    try {
      rtPolicies = (await sql`
        SELECT tablename, policyname FROM pg_policies
        WHERE schemaname = 'realtime' ORDER BY tablename, policyname
      `) as Array<{ tablename: string; policyname: string }>;
    } catch {}
    console.log(`\n  realtime.* RLS policies (${rtPolicies.length}):`);
    for (const r of rtPolicies)
      console.log(`    - realtime.${r.tablename}.${r.policyname}`);

    // Is REPLICA IDENTITY FULL on watched tables? Required for realtime UPDATE/DELETE events to include row data
    const repIdent = (await sql`
      SELECT c.relname AS tablename, c.relreplident AS replica_identity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND c.relname = ANY(${pub.map((p) => p.tablename)}::text[])
      ORDER BY c.relname
    `) as Array<{ tablename: string; replica_identity: string }>;
    console.log(
      `\n  REPLICA IDENTITY (d=default/primary key, f=full, n=nothing, i=index):`,
    );
    for (const r of repIdent)
      console.log(
        `    - ${r.tablename.padEnd(22)} ${r.replica_identity} ${r.replica_identity === "f" ? "(full — captures row data)" : "(default — primary key only)"}`,
      );

    // ─── 3. Active work right now ─────────────────────────────────────
    console.log("\n" + "=".repeat(70));
    console.log("3. Active work right now (drives realtime poll fallback)");
    console.log("=".repeat(70));
    const active = (await sql`
      SELECT id, name, status, type, last_run_at, next_run_at
      FROM collections
      WHERE org_id = ${orgId} AND status IN ('queued', 'running')
    `) as Array<{
      id: string;
      name: string;
      status: string;
      type: string;
      last_run_at: Date | null;
      next_run_at: Date | null;
    }>;
    console.log(`\n  Collections in queued/running state: ${active.length}`);
    for (const c of active) console.log(`    ${c.status}  ${c.type}  ${c.name}`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("[diagnose-bridge-issues] fatal:", e);
  process.exit(1);
});
