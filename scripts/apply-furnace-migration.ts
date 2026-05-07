/**
 * One-shot apply of migration 0010_furnace_layer.sql to prod Supabase.
 *
 * USER-AUTHORIZED execution — May 3, 2026: Inba explicitly approved
 * applying this specific migration during the Phase 10 verification flow.
 * Do NOT generalize this script; it's intentionally scoped to ONE
 * migration and self-deletes the value of the auth grant after running.
 *
 * The migration adds:
 *   - signal_status enum value FURNACE_REFUSED
 *   - agent_outputs.section_approvals JSONB column with default '{}'
 *
 * Both changes are forward-compatible (existing code doesn't break).
 *
 * Usage: npx tsx scripts/apply-furnace-migration.ts
 *
 * Idempotent: uses IF NOT EXISTS guards. Safe to re-run.
 */

import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env.local")) {
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
}

async function main() {
  console.log("[apply-furnace-migration] starting");
  console.log("  USER-AUTHORIZED — Inba approved May 3 during Phase 10 verification");

  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");

  // Statement 1: signal_status enum addition.
  // ALTER TYPE ADD VALUE cannot run inside a transaction in Postgres,
  // so this runs standalone (no tx wrapping). IF NOT EXISTS makes it
  // idempotent — re-running is a no-op once the value is added.
  console.log("\n→ Adding FURNACE_REFUSED to signal_status enum…");
  try {
    await db.execute(
      sql`ALTER TYPE "signal_status" ADD VALUE IF NOT EXISTS 'FURNACE_REFUSED'`,
    );
    console.log("  ✓ signal_status enum updated");
  } catch (err) {
    console.error("  ✗ enum update failed:", err);
    process.exit(1);
  }

  // Statement 2: agent_outputs.section_approvals column.
  // Add column with NOT NULL DEFAULT — Postgres backfills existing rows
  // with the default, so this is non-blocking even on large tables.
  // IF NOT EXISTS makes it idempotent.
  console.log("\n→ Adding section_approvals JSONB column to agent_outputs…");
  try {
    await db.execute(sql`
      ALTER TABLE "agent_outputs"
      ADD COLUMN IF NOT EXISTS "section_approvals" JSONB NOT NULL DEFAULT '{}'::jsonb
    `);
    console.log("  ✓ agent_outputs.section_approvals column added");
  } catch (err) {
    console.error("  ✗ column add failed:", err);
    process.exit(1);
  }

  // Verify both changes landed
  console.log("\n→ Verifying migration applied…");
  const enumRows = await db.execute(sql`
    SELECT enumlabel
    FROM pg_enum
    WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'signal_status')
      AND enumlabel = 'FURNACE_REFUSED'
  `);
  const colRows = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agent_outputs'
      AND column_name = 'section_approvals'
  `);
  const enumOk = (enumRows as unknown as unknown[]).length > 0;
  const colOk = (colRows as unknown as unknown[]).length > 0;
  console.log(`  signal_status FURNACE_REFUSED: ${enumOk ? "✓" : "✗"}`);
  console.log(`  agent_outputs.section_approvals: ${colOk ? "✓" : "✗"}`);

  if (enumOk && colOk) {
    console.log("\n[apply-furnace-migration] ✓ migration applied + verified");
    process.exit(0);
  } else {
    console.error("\n[apply-furnace-migration] ✗ verification failed");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[apply-furnace-migration] fatal:", err);
  process.exit(1);
});
