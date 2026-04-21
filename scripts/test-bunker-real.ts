/**
 * End-to-end smoke test for BUNKER against REAL source connectors.
 *
 * Runs each source one at a time (so failures isolate cleanly), with the
 * source config loaded from Supabase (`config_agents.BUNKER.*`).
 *
 * Cost guard: each BUNKER extraction is ~$0.0001 (Gemini 2.5 Flash).
 * Expected 1-2 cents total across all sources on first run.
 *
 * Usage: npx tsx scripts/test-bunker-real.ts [source1 source2 ...]
 *   Defaults to all 4: reddit, rss, trends, llm_synthesis
 */

import { readFileSync } from "node:fs";

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

const SOURCES_ARG = process.argv.slice(2);
const SOURCES_TO_TEST =
  SOURCES_ARG.length > 0
    ? SOURCES_ARG
    : ["reddit", "rss", "trends", "llm_synthesis"];

async function main() {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../src/db");
  const { orgs } = await import("../src/db/schema");
  const { runBunkerCollection } = await import(
    "../src/lib/inngest/functions/bunker"
  );

  const [org] = await db.select().from(orgs).where(eq(orgs.slug, "blips"));
  if (!org) {
    console.error("✗ No BLIPS org");
    process.exit(1);
  }
  console.log(`✓ BLIPS org ${org.id}`);
  console.log(`→ Testing sources: ${SOURCES_TO_TEST.join(", ")}\n`);

  for (const source of SOURCES_TO_TEST) {
    console.log(`━━━ ${source.toUpperCase()} ━━━`);
    const start = Date.now();
    try {
      const stats = await runBunkerCollection({
        orgId: org.id,
        sources: [source],
      });
      const duration = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  Duration:  ${duration}s`);
      console.log(`  Fetched:   ${stats.fetched}`);
      console.log(`  Deduped:   ${stats.deduped}`);
      console.log(`  Extracted: ${stats.extracted}`);
      console.log(`  Errors:    ${stats.errors}`);
      if (stats.candidateIds.length > 0) {
        console.log(`  New candidates:`);
        for (const c of stats.candidateIds) {
          console.log(`    + ${c.shortcode}`);
        }
      }
      console.log();
    } catch (e) {
      console.error(`  ✗ ${source} crashed:`, (e as Error).message);
      console.log();
    }
  }

  console.log("✓ Real-source smoke test complete");
  process.exit(0);
}

main().catch((e) => {
  console.error("\n✗ Test failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
