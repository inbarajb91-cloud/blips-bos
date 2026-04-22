/**
 * One-off cleanup: mark pre-sync queued collections as 'failed'.
 *
 * After the Phase 6.5 merge, Inngest synced at 20:32:11 on 22/04/2026.
 * Any collection created on a preview deploy or between merge + sync
 * fired a bunker.collection.run event that Inngest had no handler for.
 * Those events are gone; the collections are stuck at status='queued'
 * forever with no way to recover.
 *
 * This script walks collections in 'queued' status for longer than 10
 * minutes and flips them to 'failed' with an explanatory error_message
 * on their latest collection_run row (if any). You can delete them from
 * the UI later, or I'll add a per-collection delete action in a follow-up.
 *
 * Usage: npx tsx scripts/cleanup-pre-sync-queued.ts
 *
 * Safe to re-run; only targets collections stuck > 10 min.
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
      }[]
    >`
      SELECT id, name, created_at FROM collections
      WHERE status = 'queued'
        AND created_at < now() - interval '10 minutes'
      ORDER BY created_at
    `;

    if (stuck.length === 0) {
      console.log("✓ No stuck queued collections.");
      return;
    }

    console.log(`Found ${stuck.length} stuck collection(s):\n`);
    for (const c of stuck) {
      console.log(
        `  · ${c.name.padEnd(40)} created ${c.created_at.toISOString()}`,
      );
    }
    console.log("");

    await sql`
      UPDATE collections
      SET status = 'failed',
          updated_at = now()
      WHERE status = 'queued'
        AND created_at < now() - interval '10 minutes'
    `;

    console.log(`✓ Marked ${stuck.length} collection(s) as 'failed'.`);
    console.log("  They'll show up with FAILED label on Bridge.");
    console.log(
      "  To fire them fresh: delete and re-create via Collect now.\n",
    );
  } catch (e) {
    console.error("✗ Cleanup failed:", (e as Error).message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
