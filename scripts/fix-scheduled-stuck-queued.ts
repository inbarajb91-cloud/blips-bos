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
 * they've been stuck for >10 min AND no collection_runs row exists for them.
 * Flip those to 'idle'. The hourly cron will then pick them up on the next
 * tick if next_run_at has passed, or at next_run_at itself.
 *
 * Age filter (updated_at < now() - 10 min) + "any run row" EXISTS check
 * both serve as race guards — they prevent this script from touching a
 * collection that cron just fired (status=queued for a few seconds until
 * Inngest flips it to running) or that has any recorded run history. The
 * earlier version only checked started_at IS NOT NULL, which would miss
 * queued run rows and could double-fire a collection if we ever add an
 * enqueued-state to collection_runs later.
 *
 * Safe to re-run.
 *
 * Usage: npx tsx scripts/fix-scheduled-stuck-queued.ts
 */

import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";

// Optional .env.local loader. Falls through silently if the file is
// absent (e.g. prod/CI shells where DATABASE_URL is already exported),
// so this script works both in local dev and operational contexts.
try {
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
} catch (e) {
  console.warn(
    "[env] .env.local present but could not be parsed:",
    (e as Error).message,
  );
}

if (!process.env.DATABASE_URL) {
  console.error(
    "Missing DATABASE_URL — set it via .env.local or the shell environment.",
  );
  process.exit(1);
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
        AND c.updated_at < now() - interval '10 minutes'
        AND NOT EXISTS (
          SELECT 1 FROM collection_runs r
          WHERE r.collection_id = c.id
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
        AND updated_at < now() - interval '10 minutes'
        AND NOT EXISTS (
          SELECT 1 FROM collection_runs r
          WHERE r.collection_id = collections.id
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
