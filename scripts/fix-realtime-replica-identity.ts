/**
 * Set REPLICA IDENTITY FULL on every table in the supabase_realtime
 * publication.
 *
 * Why this matters:
 *   - Supabase Realtime evaluates table-level RLS policies on both the
 *     OLD and NEW row of every UPDATE event before broadcasting.
 *   - With REPLICA IDENTITY DEFAULT (the Postgres default), UPDATE/DELETE
 *     WAL records contain only the primary key for the OLD row.
 *   - Our RLS policies filter by `org_id = current_org_id()`. If the OLD
 *     row in WAL only has the PK, the policy evaluator can't see org_id
 *     and the event is silently dropped.
 *   - Net effect: INSERTs come through (new row has all columns), but
 *     UPDATEs and DELETEs disappear. The UI sees new candidates appear
 *     eventually but never sees a collection's status change, never sees
 *     a signal advance stages, never sees an approval flip the card.
 *
 * Symptom this caused: "I can see candidates show up but the progress
 * indicator stays stuck. I have to refresh to see status changes."
 *
 * Fix: ALTER TABLE ... REPLICA IDENTITY FULL on every published table.
 * This is what the Supabase dashboard does when you toggle "Replication"
 * on per-table in their UI. Doing it once via ALTER PUBLICATION (which
 * is what our sync script did) misses this step.
 *
 * One-time, idempotent. Re-running is safe — REPLICA IDENTITY FULL is
 * a no-op on tables that already have it.
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
    // Resolve the list of tables in the publication. We use this rather
    // than a hardcoded list so any future ALTER PUBLICATION ADD TABLE
    // continues to be covered when we re-run this.
    const pub = (await sql`
      SELECT tablename FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      ORDER BY tablename
    `) as Array<{ tablename: string }>;
    console.log(`Publication has ${pub.length} tables. Inspecting REPLICA IDENTITY...`);

    const before = (await sql`
      SELECT c.relname AS tablename, c.relreplident AS replica_identity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY(${pub.map((p) => p.tablename)}::text[])
      ORDER BY c.relname
    `) as Array<{ tablename: string; replica_identity: string }>;
    for (const r of before) {
      console.log(
        `  - ${r.tablename.padEnd(22)} ${r.replica_identity}${r.replica_identity === "f" ? " (already FULL)" : " (DEFAULT → needs fix)"}`,
      );
    }

    const toFix = before.filter((r) => r.replica_identity !== "f");
    if (toFix.length === 0) {
      console.log("\n✓ All published tables already have REPLICA IDENTITY FULL. Nothing to do.");
      return;
    }

    console.log(`\nSetting REPLICA IDENTITY FULL on ${toFix.length} tables...`);
    for (const r of toFix) {
      const ddl = `ALTER TABLE public.${r.tablename} REPLICA IDENTITY FULL`;
      await sql.unsafe(ddl);
      console.log(`  ✓ ${r.tablename}`);
    }

    const after = (await sql`
      SELECT c.relname AS tablename, c.relreplident AS replica_identity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY(${pub.map((p) => p.tablename)}::text[])
      ORDER BY c.relname
    `) as Array<{ tablename: string; replica_identity: string }>;
    const stillBroken = after.filter((r) => r.replica_identity !== "f");
    console.log(
      `\n${stillBroken.length === 0 ? "✓" : "✗"} Post-state: ${after.length - stillBroken.length}/${after.length} tables on FULL.`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("[fix-realtime-replica-identity] fatal:", e);
  process.exit(1);
});
