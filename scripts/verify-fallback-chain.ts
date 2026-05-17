/**
 * Verify the probe-then-call fallback pattern against the live AI SDK.
 *
 * Exercises `pickHealthyModel` from src/lib/ai/probe.ts — the shared
 * helper that both `streamOrcReply` and `generateStructured` now use to
 * walk the configured fallback chain.
 *
 * The May 15 BOILER incident hit a real bug in `generateStructured`:
 * primary model `claude-sonnet-4.7` (doesn't exist) + missing
 * Anthropic key threw a permanent-shaped error that killed the call
 * instead of advancing to the healthy `gemini-2.5-pro` in slot #2.
 * Phase 3.5's probe-then-stream upgrade only fixed this for the ORC
 * streaming path; this verify script confirms the fix now extends to
 * the structured-call path.
 *
 * Test matrix:
 *   1. Single healthy model    → fallbacksUsed = 0, returns slot 0
 *   2. Bad primary + healthy backup → fallbacksUsed = 1, returns slot 1
 *   3. Two bad + healthy backup → fallbacksUsed = 2, returns slot 2
 *   4. All bad models → throws friendly aggregated error
 *
 * Cost: each "bad" model fails its probe in <1s; each "healthy" probe
 * spends ~4 output tokens (~$0.0001). Full suite is under $0.001.
 *
 * Run: pnpm tsx --env-file=.env.local scripts/verify-fallback-chain.ts
 */

import { pickHealthyModel } from "@/lib/ai/probe";

const HEALTHY = "gemini-2.5-flash";
const BAD_MODEL_ID = "claude-sonnet-4.7"; // the May 15 incident's missing model id

interface Case {
  name: string;
  chain: string[];
  expectFallbacks?: number;
  expectModelId?: string;
  expectThrow?: boolean;
}

const cases: Case[] = [
  {
    name: "healthy primary, no fallback used",
    chain: [HEALTHY],
    expectFallbacks: 0,
    expectModelId: HEALTHY,
  },
  {
    name: "bad primary (claude-sonnet-4.7) + healthy backup — the May 15 BOILER case",
    chain: [BAD_MODEL_ID, HEALTHY],
    expectFallbacks: 1,
    expectModelId: HEALTHY,
  },
  {
    name: "two bad models + healthy slot #3",
    chain: [BAD_MODEL_ID, "another-nonexistent-model-id", HEALTHY],
    expectFallbacks: 2,
    expectModelId: HEALTHY,
  },
  {
    name: "all-bad chain throws friendly aggregated error",
    chain: [BAD_MODEL_ID, "another-nonexistent-model-id"],
    expectThrow: true,
  },
];

interface CaseResult {
  name: string;
  passed: boolean;
  detail: string;
}

async function runCase(c: Case): Promise<CaseResult> {
  const started = Date.now();
  try {
    const result = await pickHealthyModel(c.chain, "BUNKER", "verify-fallback-chain");
    const ms = Date.now() - started;
    if (c.expectThrow) {
      return {
        name: c.name,
        passed: false,
        detail: `expected throw, got success modelId=${result.modelId} fallbacks=${result.fallbacksUsed} (${ms}ms)`,
      };
    }
    const wrongModel =
      c.expectModelId !== undefined && result.modelId !== c.expectModelId;
    const wrongFallbacks =
      c.expectFallbacks !== undefined && result.fallbacksUsed !== c.expectFallbacks;
    if (wrongModel || wrongFallbacks) {
      return {
        name: c.name,
        passed: false,
        detail: `modelId=${result.modelId} fallbacks=${result.fallbacksUsed} — expected modelId=${c.expectModelId} fallbacks=${c.expectFallbacks} (${ms}ms)`,
      };
    }
    return {
      name: c.name,
      passed: true,
      detail: `modelId=${result.modelId} fallbacks=${result.fallbacksUsed} (${ms}ms)`,
    };
  } catch (e) {
    const ms = Date.now() - started;
    const msg = e instanceof Error ? e.message : String(e);
    if (c.expectThrow) {
      // Check the message looks like the friendly aggregated error
      const friendly = msg.includes("fallback chain failed health probes");
      return {
        name: c.name,
        passed: friendly,
        detail: friendly
          ? `threw friendly aggregated error (${ms}ms)`
          : `threw but message doesn't look friendly: "${msg.slice(0, 100)}" (${ms}ms)`,
      };
    }
    return {
      name: c.name,
      passed: false,
      detail: `unexpected throw: ${msg.slice(0, 140)} (${ms}ms)`,
    };
  }
}

async function main() {
  console.log("verify-fallback-chain — exercising pickHealthyModel against live AI SDK\n");
  const results: CaseResult[] = [];
  for (const c of cases) {
    process.stdout.write(`  · ${c.name}\n    `);
    const r = await runCase(c);
    results.push(r);
    console.log(`${r.passed ? "PASS" : "FAIL"} — ${r.detail}\n`);
  }

  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${passed}/${results.length} cases passed`);
  if (passed !== results.length) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Top-level failure:", e);
  process.exit(1);
});
