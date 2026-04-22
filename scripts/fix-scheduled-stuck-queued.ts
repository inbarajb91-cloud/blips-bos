/**
 * One-off fix: flip stuck-queued Scheduled collections to 'idle'.
 *
 * Why stuck: createCollection previously set every collection to status='queued'
 * on creation, but only fired an Inngest event for Instant/Batch. Scheduled
 * collections were supposed to wait for the hourly cron (bunkerScheduledCheck),
 * but that cron filters `status='idle'` — so they were invisible to it AND
 * couldn't be manually re-fired because the Run Now button gates on !isActive
 * (queued counts as active).
 *
 * Result: every scheduled collection created pre-fix sits with
 *   status='queued', next_run_at=<future>
 * forever, showing "QUEUED · STARTING…" on the spine with no actual activity.
 *
 * Fix (in code): createCollection now sets scheduled → status='idle'.
 *
 * This script: walk existing scheduled collections where status='queued' AND
 * no run has ever fired (no matching row in collection_runs where
 * started_at IS NOT NULL), flip them to 'idle'. The hourly cron will then
 * pick them up on the next tick if next_run_at <= now, or at next_run_at.
 *
 * Safe to re-run.
 *
 * Usage: npx tsx scripts/fix-scheduled-stuck-queued.ts
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
    const stuck = await sql<
      {
        id: string;
        name: string;
        created_at: Date;
        next_run_at: Date | null;
      }[]
    >`
      SELECT c.id, c.name, c.created_at, c.next_run_at
      FROM collections c
      WHERE c.type = 'scheduled'
        AND c.status = 'queued'
        AND NOT EXISTS (
          SELECT 1 FROM collection_runs r
          WHERE r.collection_id = c.id
            AND r.started_at IS NOT NULL
        )
      ORDER BY c.created_at
    `;

    if (stuck.length === 0) {
      console.log("✓ No stuck scheduled collections.");
      return;
    }

    console.log(`Found ${stuck.length} stuck scheduled collection(s):\n`);
    for (const c of stuck) {
      const nextRun = c.next_run_at
        ? c.next_run_at.toISOString()
        : "(no next_run_at)";
      console.log(
        `  · ${c.name.padEnd(40)} next_run_at ${nextRun}`,
      );
    }
    console.log("");

    await sql`
      UPDATE collections
      SET status = 'idle',
          updated_at = now()
      WHERE type = 'scheduled'
        AND status = 'queued'
        AND NOT EXISTS (
          SELECT 1 FROM collection_runs r
          WHERE r.collection_id = collections.id
            AND r.started_at IS NOT NULL
        )
    `;

    console.log(`✓ Flipped ${stuck.length} scheduled collection(s) to 'idle'.`);
    console.log(
      "  Hourly cron (bunkerScheduledCheck) will pick them up on the next\n" +
        "  tick if next_run_at has already passed, or on next_run_at itself.\n" +
        "  Run Now button on the spine is also visible now.",
    );
  } catch (e) {
    console.error("✗ Fix failed:", (e as Error).message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
