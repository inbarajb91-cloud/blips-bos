/**
 * End-to-end smoke test for the supermemory backend wrapper — Phase 8K.
 *
 * Exercises:
 *   1. .env.local SUPERMEMORY_API_KEY loads
 *   2. getMemoryBackend() selects SupermemoryBackend (not Noop)
 *   3. remember() writes a document and returns a non-empty id
 *   4. recall() returns without error (empty results are OK — supermemory
 *      processes new docs async, so a recall right after add may not see
 *      the just-written content. The point of this test is contract
 *      validation, not retrieval quality.)
 *
 * Usage: npx tsx scripts/test-memory-roundtrip.ts
 *
 * Cost: one document add + one search call. Both well under the free
 * tier's per-day allowance (~$0 effective).
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
  if (!process.env.SUPERMEMORY_API_KEY) {
    console.error("✗ SUPERMEMORY_API_KEY missing from .env.local");
    process.exit(1);
  }
  console.log("✓ SUPERMEMORY_API_KEY present");

  const { getMemoryBackend } = await import("../src/lib/orc/memory");
  const backend = await getMemoryBackend();
  console.log(`✓ Backend selected: ${backend.constructor.name}`);

  if (backend.constructor.name === "NoopMemoryBackend") {
    console.error("✗ Backend is Noop — env var didn't load. Aborting.");
    process.exit(1);
  }

  // Use a real BLIPS org id so the smoke memory is tagged correctly.
  // If you want it isolated, swap in a test orgId below.
  const { db } = await import("../src/db");
  const { orgs } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const [org] = await db.select().from(orgs).where(eq(orgs.slug, "blips"));
  if (!org) {
    console.error("✗ BLIPS org not found in DB. Aborting.");
    process.exit(1);
  }
  console.log(`✓ Using org: ${org.slug} (${org.id})`);

  // ── 1. Write a memory ──────────────────────────────────────────
  const marker = `SMOKE-TEST-${Date.now()}`;
  const writeStart = Date.now();
  const writeResult = await backend.remember({
    orgId: org.id,
    container: "test", // ISOLATED test container — never visible to production recall
    kind: "note",
    content: `${marker}: This is a smoke-test memory for the BLIPS supermemory wrapper. The phrase "career vs biology tension" is a marker phrase the recall test will search for.`,
    metadata: {
      source: "test-memory-roundtrip",
      marker,
    },
  });
  const writeMs = Date.now() - writeStart;

  if (!writeResult.id) {
    console.error("✗ remember() returned empty id — write failed silently. Check console above for the swallowed error.");
    process.exit(1);
  }
  console.log(`✓ remember() returned id: ${writeResult.id} (${writeMs}ms)`);

  // ── 2. Recall (without expecting hits — extraction is async on
  // supermemory's side, can take seconds to minutes) ─────────────
  const recallStart = Date.now();
  const hits = await backend.recall("career vs biology tension", {
    orgId: org.id,
    container: "test", // search the test container we just wrote to
    limit: 5,
  });
  const recallMs = Date.now() - recallStart;

  console.log(
    `✓ recall() returned ${hits.length} hit(s) in ${recallMs}ms ` +
      "(zero is fine on first run — extraction is async)",
  );
  for (const h of hits.slice(0, 3)) {
    console.log(
      `   - id=${h.id} score=${h.score.toFixed(3)} kind=${h.kind} content="${h.content.slice(0, 80)}…"`,
    );
  }

  console.log("\n✓ Smoke test passed. Backend wrapper is wired correctly.");
  console.log(
    "  (If you re-run in 30-60s, the document will be indexed and recall should return the test memory.)",
  );

  await db.$client.end();
}

main().catch((err) => {
  console.error("\n✗ Smoke test failed:", err);
  process.exit(1);
});
