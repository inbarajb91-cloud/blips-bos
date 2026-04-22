/**
 * Phase 6.5 migration — collections + collection_runs + FKs.
 *
 * Idempotent. Safe to re-run. Uses raw SQL because drizzle-kit push crashes
 * on enum changes in our current schema shape (same bug we hit adding
 * `llm_synthesis` to signal_source — see scripts/add-enum-value.ts).
 *
 * What this creates:
 *   - enum  collection_type        (instant | batch | scheduled)
 *   - enum  collection_status      (queued | running | idle | archived | failed)
 *   - enum  collection_cadence     (daily | weekly | monthly | custom)
 *   - table collections
 *   - table collection_runs
 *   - col   bunker_candidates.collection_id  (nullable FK)
 *   - col   signals.collection_id            (nullable FK)
 *   - RLS policies on the two new tables (org-scoped via current_org_id())
 *
 * Run: npx tsx scripts/migrate-phase-6-5.ts
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";

// .env.local loader
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
    console.log("Phase 6.5 migration — collections + FKs\n");

    // ── Enums ──────────────────────────────────────────────
    console.log("1. Creating enums (idempotent)…");
    await sql`DO $$ BEGIN
      CREATE TYPE collection_type AS ENUM ('instant', 'batch', 'scheduled');
    EXCEPTION WHEN duplicate_object THEN null; END $$;`;
    console.log("   ✓ collection_type");

    await sql`DO $$ BEGIN
      CREATE TYPE collection_status AS ENUM ('queued', 'running', 'idle', 'archived', 'failed');
    EXCEPTION WHEN duplicate_object THEN null; END $$;`;
    console.log("   ✓ collection_status");

    await sql`DO $$ BEGIN
      CREATE TYPE collection_cadence AS ENUM ('daily', 'weekly', 'monthly', 'custom');
    EXCEPTION WHEN duplicate_object THEN null; END $$;`;
    console.log("   ✓ collection_cadence");

    // ── collections ────────────────────────────────────────
    console.log("\n2. Creating collections table (idempotent)…");
    await sql`
      CREATE TABLE IF NOT EXISTS collections (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
        name text NOT NULL,
        outline text,
        type collection_type NOT NULL,
        target_count integer NOT NULL,
        cadence collection_cadence,
        cadence_cron text,
        status collection_status NOT NULL DEFAULT 'queued',
        candidate_count integer NOT NULL DEFAULT 0,
        signal_count integer NOT NULL DEFAULT 0,
        created_by uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        last_run_at timestamptz,
        next_run_at timestamptz
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS collections_org_status_idx ON collections(org_id, status)`;
    await sql`CREATE INDEX IF NOT EXISTS collections_org_created_idx ON collections(org_id, created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS collections_next_run_idx ON collections(next_run_at)`;
    console.log("   ✓ collections + 3 indexes");

    // ── collection_runs ────────────────────────────────────
    console.log("\n3. Creating collection_runs table (idempotent)…");
    await sql`
      CREATE TABLE IF NOT EXISTS collection_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
        status collection_status NOT NULL DEFAULT 'queued',
        started_at timestamptz,
        completed_at timestamptz,
        fetched_raw integer NOT NULL DEFAULT 0,
        deduped integer NOT NULL DEFAULT 0,
        extracted integer NOT NULL DEFAULT 0,
        errors integer NOT NULL DEFAULT 0,
        sources_snapshot jsonb,
        error_message text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS collection_runs_collection_idx ON collection_runs(collection_id)`;
    await sql`CREATE INDEX IF NOT EXISTS collection_runs_org_created_idx ON collection_runs(org_id, created_at)`;
    console.log("   ✓ collection_runs + 2 indexes");

    // ── FKs on existing tables ─────────────────────────────
    console.log("\n4. Adding collection_id to bunker_candidates (idempotent)…");
    await sql`ALTER TABLE bunker_candidates ADD COLUMN IF NOT EXISTS collection_id uuid REFERENCES collections(id) ON DELETE SET NULL`;
    await sql`CREATE INDEX IF NOT EXISTS bunker_candidates_collection_idx ON bunker_candidates(collection_id)`;
    console.log("   ✓ bunker_candidates.collection_id");

    console.log("\n5. Adding collection_id to signals (idempotent)…");
    await sql`ALTER TABLE signals ADD COLUMN IF NOT EXISTS collection_id uuid REFERENCES collections(id) ON DELETE SET NULL`;
    await sql`CREATE INDEX IF NOT EXISTS signals_org_collection_idx ON signals(org_id, collection_id)`;
    console.log("   ✓ signals.collection_id");

    // ── RLS ────────────────────────────────────────────────
    console.log("\n6. Applying RLS on the new tables (idempotent)…");
    await sql`ALTER TABLE collections ENABLE ROW LEVEL SECURITY`;
    await sql`ALTER TABLE collection_runs ENABLE ROW LEVEL SECURITY`;

    await sql`DROP POLICY IF EXISTS collections_org_policy ON collections`;
    await sql`
      CREATE POLICY collections_org_policy ON collections
        USING (org_id = current_org_id())
        WITH CHECK (org_id = current_org_id())
    `;

    await sql`DROP POLICY IF EXISTS collection_runs_org_policy ON collection_runs`;
    await sql`
      CREATE POLICY collection_runs_org_policy ON collection_runs
        USING (org_id = current_org_id())
        WITH CHECK (org_id = current_org_id())
    `;
    console.log("   ✓ RLS + policies on both tables");

    // ── Realtime publication ───────────────────────────────
    console.log("\n7. Adding collections + collection_runs to Realtime publication…");
    const pubTables = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
    `;
    const hasCollections = pubTables.some((r) => r.tablename === "collections");
    const hasRuns = pubTables.some((r) => r.tablename === "collection_runs");
    if (!hasCollections) {
      await sql`ALTER PUBLICATION supabase_realtime ADD TABLE collections`;
      console.log("   ✓ collections added to realtime");
    } else {
      console.log("   ○ collections already in realtime");
    }
    if (!hasRuns) {
      await sql`ALTER PUBLICATION supabase_realtime ADD TABLE collection_runs`;
      console.log("   ✓ collection_runs added to realtime");
    } else {
      console.log("   ○ collection_runs already in realtime");
    }

    // ── Default collection for legacy rows ─────────────────
    console.log("\n8. Seeding default collection for pre-6.5 candidates/signals…");
    const [org] = await sql<{ id: string }[]>`
      SELECT id FROM orgs WHERE slug = 'blips' LIMIT 1
    `;
    if (!org) {
      console.log("   ⚠ BLIPS org not found; skipping legacy assignment.");
    } else {
      // Ensure exactly one default "Legacy" collection.
      const [existing] = await sql<{ id: string }[]>`
        SELECT id FROM collections
        WHERE org_id = ${org.id}::uuid AND name = 'Legacy — pre-6.5'
        LIMIT 1
      `;
      let legacyId: string;
      if (existing) {
        legacyId = existing.id;
        console.log(`   ○ Legacy collection exists: ${legacyId}`);
      } else {
        const [row] = await sql<{ id: string }[]>`
          INSERT INTO collections (
            org_id, name, outline, type, target_count, status
          ) VALUES (
            ${org.id}::uuid,
            'Legacy — pre-6.5',
            'All candidates collected before collections existed. Grouped here for continuity.',
            'batch',
            100,
            'idle'
          )
          RETURNING id
        `;
        legacyId = row.id;
        console.log(`   ✓ Legacy collection created: ${legacyId}`);
      }

      // Backfill every orphan candidate/signal into Legacy.
      const cUpdated = await sql<{ count: number }[]>`
        WITH updated AS (
          UPDATE bunker_candidates SET collection_id = ${legacyId}::uuid
          WHERE org_id = ${org.id}::uuid AND collection_id IS NULL
          RETURNING 1
        )
        SELECT count(*)::int as count FROM updated
      `;
      const sUpdated = await sql<{ count: number }[]>`
        WITH updated AS (
          UPDATE signals SET collection_id = ${legacyId}::uuid
          WHERE org_id = ${org.id}::uuid AND collection_id IS NULL
          RETURNING 1
        )
        SELECT count(*)::int as count FROM updated
      `;
      // Sync aggregate counters on Legacy.
      await sql`
        UPDATE collections SET
          candidate_count = (SELECT count(*) FROM bunker_candidates WHERE collection_id = ${legacyId}::uuid),
          signal_count    = (SELECT count(*) FROM signals           WHERE collection_id = ${legacyId}::uuid),
          updated_at = now()
        WHERE id = ${legacyId}::uuid
      `;
      console.log(
        `   ✓ Backfilled ${cUpdated[0].count} candidates + ${sUpdated[0].count} signals into Legacy`,
      );
    }

    console.log("\n✓ Phase 6.5 migration complete.\n");
  } catch (e) {
    console.error("\n✗ Migration failed:", (e as Error).message);
    console.error((e as Error).stack);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
