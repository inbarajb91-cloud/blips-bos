/**
 * Replicate the four Bridge queries against the new DB and isolate which one
 * the Vercel runtime is failing on. Vercel MCP truncates the SQL detail in
 * the runtime log, so we can't see the actual postgres error code or the
 * unknown column / relation it's complaining about.
 *
 * Each block is run independently with full error reporting.
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
  const v = t
    .slice(eq + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!process.env[k]) process.env[k] = v;
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
  });
  const ORG = "00000000-0000-0000-0000-000000000000"; // placeholder; we'll fetch real
  try {
    const [org] = (await sql`SELECT id FROM orgs WHERE slug = 'blips' LIMIT 1`) as Array<{
      id: string;
    }>;
    const orgId = org.id;
    console.log(`org_id = ${orgId}\n`);

    // Query 1: collections
    try {
      const r =
        await sql`SELECT * FROM collections WHERE org_id = ${orgId} AND status != 'archived' ORDER BY updated_at DESC`;
      console.log(`Q1 collections OK (${r.length} rows)`);
    } catch (e) {
      console.error(`Q1 collections FAILED:`, (e as Error).message);
    }

    // Query 2: bunker_candidates pending
    try {
      const r =
        await sql`SELECT id, collection_id, shortcode, working_title, concept, source, created_at FROM bunker_candidates WHERE org_id = ${orgId} AND status = 'PENDING_REVIEW' ORDER BY created_at DESC`;
      console.log(`Q2 bunker_candidates OK (${r.length} rows)`);
    } catch (e) {
      console.error(`Q2 bunker_candidates FAILED:`, (e as Error).message);
    }

    // Query 3: signals (this is the one that uses Phase 9E columns)
    try {
      const r =
        await sql`SELECT id, collection_id, shortcode, working_title, concept, source, status, updated_at, parent_signal_id, manifestation_decade FROM signals WHERE org_id = ${orgId} AND status != 'DISMISSED' ORDER BY updated_at DESC`;
      console.log(`Q3 signals (with parent + decade) OK (${r.length} rows)`);
    } catch (e) {
      console.error(`Q3 signals FAILED:`, (e as Error).message);
    }

    // Query 4: collection_runs
    try {
      const r =
        await sql`SELECT id, collection_id, status, fetched_raw, deduped, extracted, errors, started_at, completed_at, created_at FROM collection_runs WHERE org_id = ${orgId} ORDER BY created_at DESC`;
      console.log(`Q4 collection_runs OK (${r.length} rows)`);
    } catch (e) {
      console.error(`Q4 collection_runs FAILED:`, (e as Error).message);
    }

    // Diff which signals columns actually exist
    console.log("\nsignals columns on new DB:");
    const cols =
      (await sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='signals' ORDER BY ordinal_position`) as Array<{
        column_name: string;
      }>;
    for (const c of cols) console.log(`  - ${c.column_name}`);

    console.log("\ncollection_runs columns on new DB:");
    const cr =
      (await sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='collection_runs' ORDER BY ordinal_position`) as Array<{
        column_name: string;
      }>;
    for (const c of cr) console.log(`  - ${c.column_name}`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("[diagnose] fatal:", e);
  process.exit(1);
});
