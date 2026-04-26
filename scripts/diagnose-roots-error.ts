/**
 * Diagnostic for the ROOTS Bridge server-error.
 *
 * The Bridge shows "ROOTS  Golden Handcuffs Of Home" in TRIAGE, but
 * the signals table has "ROOTS  Rooted Flight". Suspicion: shortcode
 * collision between an existing signal and a pending bunker_candidate
 * causes the approve flow (or some related Bridge query) to crash.
 */

import { existsSync, readFileSync } from "node:fs";

// Optional .env.local — guarded so the script works in CI / preview
// shells where env vars come from the environment rather than a file.
if (existsSync(".env.local")) {
  const envFile = readFileSync(".env.local", "utf-8");
  for (const line of envFile.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

async function main() {
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");

  console.log("─── 1. bunker_candidates with shortcode='ROOTS' ───");
  const cands = await db.execute(sql`
    SELECT id, shortcode, working_title, status, collection_id, created_at
    FROM bunker_candidates
    WHERE shortcode = 'ROOTS'
    ORDER BY created_at DESC
  `);
  console.log(JSON.stringify(cands, null, 2));

  console.log("\n─── 2. signals with shortcode='ROOTS' ───");
  const sigs = await db.execute(sql`
    SELECT id, shortcode, working_title, status, collection_id, created_at
    FROM signals
    WHERE shortcode = 'ROOTS'
    ORDER BY created_at DESC
  `);
  console.log(JSON.stringify(sigs, null, 2));

  console.log("\n─── 3. shortcode UNIQUE constraints on signals ───");
  const idx = await db.execute(sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'signals'
      AND (indexname LIKE '%shortcode%' OR indexdef LIKE '%shortcode%')
  `);
  console.log(JSON.stringify(idx, null, 2));

  console.log("\n─── 4. shortcode UNIQUE constraints on bunker_candidates ───");
  const idx2 = await db.execute(sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'bunker_candidates'
      AND (indexname LIKE '%shortcode%' OR indexdef LIKE '%shortcode%')
  `);
  console.log(JSON.stringify(idx2, null, 2));

  console.log("\n─── 5. ALL duplicate shortcodes across BOTH tables ───");
  const dups = await db.execute(sql`
    WITH all_shortcodes AS (
      SELECT shortcode, 'signals' AS src FROM signals
      UNION ALL
      SELECT shortcode, 'bunker_candidates' AS src FROM bunker_candidates
    )
    SELECT shortcode, COUNT(*) AS n, array_agg(src) AS sources
    FROM all_shortcodes
    GROUP BY shortcode
    HAVING COUNT(*) > 1
    ORDER BY n DESC
    LIMIT 20
  `);
  console.log(JSON.stringify(dups, null, 2));

  await db.$client.end();
}

main().catch((err) => {
  console.error("\n✗ crashed:", err);
  process.exit(1);
});
