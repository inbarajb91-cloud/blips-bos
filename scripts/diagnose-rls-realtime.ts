/**
 * Check whether public.* RLS policies allow authenticated client
 * to subscribe to the right rows via Supabase Realtime (Postgres
 * Changes mode). Realtime subscriptions reuse the regular RLS — if
 * a user can't SELECT a row, they can't subscribe to its changes.
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
    // Per-table RLS policies for the tables we want to stream live
    const watched = [
      "signals",
      "bunker_candidates",
      "agent_outputs",
      "agent_logs",
      "signal_locks",
      "collections",
      "collection_runs",
      "knowledge_documents",
    ];

    for (const table of watched) {
      const rlsEnabled = (await sql`
        SELECT relrowsecurity FROM pg_class
        WHERE relname = ${table} AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname='public')
      `) as Array<{ relrowsecurity: boolean }>;
      const policies = (await sql`
        SELECT policyname, cmd, roles::text[] AS roles, qual::text, with_check::text
        FROM pg_policies
        WHERE schemaname='public' AND tablename = ${table}
        ORDER BY policyname
      `) as Array<{
        policyname: string;
        cmd: string;
        roles: string[];
        qual: string;
        with_check: string;
      }>;
      console.log(
        `\n${table}  rls=${rlsEnabled[0]?.relrowsecurity ?? "?"}  policies=${policies.length}`,
      );
      for (const p of policies) {
        console.log(
          `  [${p.cmd}] ${p.policyname}  roles=${(p.roles ?? []).join(",")}`,
        );
        console.log(`     USING:      ${p.qual?.slice(0, 100) ?? ""}`);
        if (p.with_check)
          console.log(`     WITH CHECK: ${p.with_check.slice(0, 100)}`);
      }
    }

    // Helper function existence
    const helper = (await sql`
      SELECT proname, prosrc FROM pg_proc WHERE proname = 'current_org_id'
    `) as Array<{ proname: string; prosrc: string }>;
    console.log(
      `\ncurrent_org_id() function: ${helper.length ? "EXISTS" : "MISSING"}`,
    );
    if (helper.length) {
      console.log(`  Definition (first 200 chars):`);
      console.log(`  ${helper[0].prosrc.slice(0, 200)}`);
    }

    // Try executing as anon to see what happens
    console.log(`\n--- Test as anon role ---`);
    try {
      const r = await sql`
        SET LOCAL ROLE anon;
        SELECT count(*)::int AS c FROM signals;
      `;
      console.log(`  anon can SELECT signals: ${JSON.stringify(r)}`);
    } catch (e) {
      console.log(`  anon SELECT failed: ${(e as Error).message}`);
    }
    try {
      await sql`RESET ROLE`;
    } catch {}
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("[diagnose-rls] fatal:", e);
  process.exit(1);
});
