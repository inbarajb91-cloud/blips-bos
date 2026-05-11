/**
 * One-shot script to create the collections + collection_runs tables on the
 * NEW Supabase project. Phase 6.5 added these via Supabase MCP `apply_migration`
 * directly without writing a SQL file to drizzle/. The fresh project doesn't
 * have them, which causes /engine-room to fail with "Failed query: select..."
 * (the page query joins from collections).
 */
import postgres from "postgres";
import { readFileSync } from "node:fs";

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

const STATEMENTS: string[] = [
  // Enums (idempotent via DO blocks)
  `DO $$ BEGIN
    CREATE TYPE collection_type AS ENUM ('instant', 'batch', 'scheduled');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN
    CREATE TYPE collection_status AS ENUM ('queued', 'running', 'idle', 'archived', 'failed');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN
    CREATE TYPE collection_search_mode AS ENUM ('trend', 'reference');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN
    CREATE TYPE collection_decade_hint AS ENUM ('any', 'RCK', 'RCL', 'RCD');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN
    CREATE TYPE collection_cadence AS ENUM ('daily', 'weekly', 'monthly', 'custom');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

  // collections table
  `CREATE TABLE IF NOT EXISTS collections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name text NOT NULL,
    outline text,
    type collection_type NOT NULL,
    target_count integer NOT NULL,
    cadence collection_cadence,
    cadence_cron text,
    search_mode collection_search_mode NOT NULL DEFAULT 'trend',
    decade_hint collection_decade_hint NOT NULL DEFAULT 'any',
    status collection_status NOT NULL DEFAULT 'queued',
    candidate_count integer NOT NULL DEFAULT 0,
    signal_count integer NOT NULL DEFAULT 0,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_run_at timestamptz,
    next_run_at timestamptz
  );`,

  // collection_runs table
  `CREATE TABLE IF NOT EXISTS collection_runs (
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
  );`,

  // Indexes
  `CREATE INDEX IF NOT EXISTS collections_org_status_idx ON collections (org_id, status);`,
  `CREATE INDEX IF NOT EXISTS collections_org_created_idx ON collections (org_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS collections_next_run_idx ON collections (next_run_at);`,
  `CREATE INDEX IF NOT EXISTS collection_runs_collection_idx ON collection_runs (collection_id);`,
  `CREATE INDEX IF NOT EXISTS collection_runs_org_created_idx ON collection_runs (org_id, created_at);`,

  // Partial UNIQUE index for singleton buckets (Phase 6.5 detail)
  `CREATE UNIQUE INDEX IF NOT EXISTS collections_org_singleton_uq
   ON collections (org_id, name)
   WHERE name IN ('Direct submissions', 'Legacy');`,

  // RLS
  `ALTER TABLE collections ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE collection_runs ENABLE ROW LEVEL SECURITY;`,
  `DO $$ BEGIN
    CREATE POLICY collections_all ON collections
      USING (org_id = current_org_id())
      WITH CHECK (org_id = current_org_id());
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN
    CREATE POLICY collection_runs_all ON collection_runs
      USING (org_id = current_org_id())
      WITH CHECK (org_id = current_org_id());
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

  // Foreign key on existing tables that reference collections (Phase 6.5)
  // bunker_candidates.collection_id and signals.collection_id were added with
  // FKs in the original migration; verify they exist.
];

// Also need to ensure bunker_candidates.collection_id and signals.collection_id columns exist
const COLUMN_ADDS: string[] = [
  `ALTER TABLE bunker_candidates ADD COLUMN IF NOT EXISTS collection_id uuid REFERENCES collections(id) ON DELETE SET NULL;`,
  `ALTER TABLE signals ADD COLUMN IF NOT EXISTS collection_id uuid REFERENCES collections(id) ON DELETE SET NULL;`,
  `CREATE INDEX IF NOT EXISTS bunker_candidates_collection_idx ON bunker_candidates (collection_id);`,
  `CREATE INDEX IF NOT EXISTS signals_org_collection_idx ON signals (org_id, collection_id);`,
];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
  });
  try {
    console.log("→ Creating collections + collection_runs tables");
    for (const stmt of STATEMENTS) {
      try {
        await sql.unsafe(stmt);
        const firstLine = stmt.split("\n")[0].slice(0, 80);
        console.log(`  ✓ ${firstLine}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(
          `  ✗ ${stmt.slice(0, 80)}: ${msg.slice(0, 200)}`,
        );
        throw e;
      }
    }

    console.log("\n→ Adding FK columns to bunker_candidates + signals");
    for (const stmt of COLUMN_ADDS) {
      try {
        await sql.unsafe(stmt);
        console.log(`  ✓ ${stmt.slice(0, 80)}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("already exists")) {
          console.log(`  ~ skipped (already exists): ${stmt.slice(0, 60)}`);
        } else {
          throw e;
        }
      }
    }

    // Verify
    const tables =
      (await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('collections', 'collection_runs') ORDER BY tablename`) as Array<{
        tablename: string;
      }>;
    console.log(
      "\nVerify:",
      tables.map((t) => t.tablename).join(", "),
    );
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
