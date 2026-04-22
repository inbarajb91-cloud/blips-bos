/**
 * Phase 6.6 migration — reference mode (search_mode) + decade_hint +
 * grounded_search source enum.
 *
 * Idempotent. Uses raw SQL because drizzle-kit push still crashes on
 * enum changes (same bug we hit adding `llm_synthesis` and the Phase 6.5
 * collection enums).
 *
 * What this creates:
 *   - enum value signal_source.grounded_search
 *   - enum  collection_search_mode     (trend | reference)
 *   - enum  collection_decade_hint     (any | RCK | RCL | RCD)
 *   - col   collections.search_mode    (NOT NULL DEFAULT 'trend')
 *   - col   collections.decade_hint    (NOT NULL DEFAULT 'any')
 *
 * Run: npx tsx scripts/migrate-phase-6-6.ts
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";

const envFile = readFileSync(".env.local", "utf-8");
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
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  try {
    console.log("Phase 6.6 migration — reference mode + decade_hint\n");

    // ── New enum value on signal_source ─────────────────────────
    console.log("1. Adding 'grounded_search' to signal_source (idempotent)…");
    await sql`ALTER TYPE signal_source ADD VALUE IF NOT EXISTS 'grounded_search'`;
    console.log("   ✓ signal_source.grounded_search");

    // ── New enums ───────────────────────────────────────────────
    console.log("\n2. Creating collection_search_mode + collection_decade_hint…");
    await sql`DO $$ BEGIN
      CREATE TYPE collection_search_mode AS ENUM ('trend', 'reference');
    EXCEPTION WHEN duplicate_object THEN null; END $$;`;
    console.log("   ✓ collection_search_mode");

    await sql`DO $$ BEGIN
      CREATE TYPE collection_decade_hint AS ENUM ('any', 'RCK', 'RCL', 'RCD');
    EXCEPTION WHEN duplicate_object THEN null; END $$;`;
    console.log("   ✓ collection_decade_hint");

    // ── Columns on collections ──────────────────────────────────
    console.log("\n3. Adding columns to collections (idempotent)…");
    await sql`ALTER TABLE collections
      ADD COLUMN IF NOT EXISTS search_mode collection_search_mode NOT NULL DEFAULT 'trend'`;
    await sql`ALTER TABLE collections
      ADD COLUMN IF NOT EXISTS decade_hint collection_decade_hint NOT NULL DEFAULT 'any'`;
    console.log("   ✓ collections.search_mode + collections.decade_hint");

    console.log("\n✓ Phase 6.6 migration complete.\n");
  } catch (e) {
    console.error("\n✗ Migration failed:", (e as Error).message);
    console.error((e as Error).stack);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
