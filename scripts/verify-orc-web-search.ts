/**
 * Verify the ORC web_search backend.
 *
 * Deterministic sanity check. Calls the WebSearchBackend directly (no
 * LLM-driven tool loop) with a couple of representative queries and
 * prints the digest + sources. Confirms the backend is wired, the API
 * key reaches it, and the result shape is bounded.
 *
 * NOT a full eval — just a smoke test. Each call costs ~$0.03 on the
 * default Gemini-grounded backend, so ~$0.06 per script run. Matches
 * the verify-script pattern from scripts/verify-orc-active-manifestation.ts.
 *
 * Run:
 *   GOOGLE_GENERATIVE_AI_API_KEY=... npx tsx scripts/verify-orc-web-search.ts
 *
 * Exit code:
 *   0 — all queries returned a non-degraded result with bounded digest + ≥1 source
 *   1 — one or more queries failed the bound checks
 *   2 — script crashed
 */

import "dotenv/config";
import { getWebSearchBackend } from "../src/lib/orc/web-search";

const QUERIES: { query: string; reason: string }[] = [
  {
    query: "what is the FUEGO design movement",
    reason: "an unknown / current concept ORC might be asked to define",
  },
  {
    query: "indigo selvedge denim production techniques 2026",
    reason: "a domain-specific current-fact lookup typical of BLIPS work",
  },
];

async function main(): Promise<void> {
  const backend = getWebSearchBackend();

  console.log(`Backend resolved: ${backend.constructor.name}`);
  console.log(
    `GOOGLE_GENERATIVE_AI_API_KEY present: ${Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY)}`,
  );
  console.log("");

  let passed = 0;
  let failed = 0;

  for (const { query, reason } of QUERIES) {
    console.log(`─── Query: "${query}"`);
    console.log(`    (${reason})`);
    const start = Date.now();

    try {
      const result = await backend.search(query);
      const ms = Date.now() - start;

      console.log(
        `    ${ms}ms · degraded=${Boolean(result.degraded)} · sources=${result.sources.length} · digest=${result.digest.length} chars`,
      );
      console.log("");
      console.log(`    DIGEST:`);
      console.log(
        result.digest
          .split("\n")
          .map((l) => `      ${l}`)
          .join("\n"),
      );
      console.log("");
      console.log(`    SOURCES:`);
      result.sources.forEach((s, i) => {
        console.log(`      [${i + 1}] ${s.title}`);
        console.log(`          ${s.url}`);
      });
      console.log("");

      // Pass criteria: not degraded, digest non-empty + bounded ≤1500,
      // 1 to 8 sources. The bounds match the contract documented on
      // WebSearchResult — if any backend implementation drifts past
      // them, this script is the canary.
      const ok =
        !result.degraded &&
        result.digest.length > 0 &&
        result.digest.length <= 1500 &&
        result.sources.length >= 1 &&
        result.sources.length <= 8;

      console.log(`    => ${ok ? "PASS" : "FAIL"}`);
      console.log("");

      if (ok) passed++;
      else failed++;
    } catch (e) {
      console.log(
        `    THROWN — backend contract violated (must never throw): ${(e as Error).message}`,
      );
      failed++;
    }
  }

  console.log(
    `─── Result: ${passed} pass / ${failed} fail (of ${QUERIES.length})`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify script crashed:", e);
  process.exit(2);
});
