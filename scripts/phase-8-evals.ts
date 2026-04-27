/**
 * Phase 8 eval suite — Conversational ORC + Memory Layer acceptance.
 *
 * Phase 8's acceptance isn't a single 15/15 like BUNKER — it's multiple
 * interacting components (reply path, memory layer, hooks, tools).
 * This suite checks the critical paths against acceptance criteria
 * before Phase 8J PR opens.
 *
 * HARD criteria (must pass — blocks PR):
 *   E1  Compression bug: count-based trigger fires at messages > 10
 *   E2  Compression bug: messages older than window survive (not silently dropped)
 *   E3  Token budget: LEDGR-shape signal fits inside the 5k cap
 *   E4  Token budget: system_brand_signal stays under 2500-token bucket cap

 *   E5  Memory wrapper: remember() events-container write returns
 *       non-empty id (THEN forget() the doc immediately so it never
 *       lingers in production recall)
 *   E6  Memory wrapper: remember() returns non-empty id on valid write (test container)
 *   E7  Memory wrapper: recall() returns [] (length=0, not just any array) when no matches
 *   E8  Container isolation: prod recall does NOT see test-container writes
 *       (waits for supermemory extraction to complete before checking,
 *       so "no hit" is conclusive — not inconclusive due to async indexing)
 *   E9  Shortcode resolver: returns unused suffix when base is taken
 *   E10 Shortcode resolver: returns base when free
 *
 * SOFT criteria (reported, not blocking):
 *   S1  Recall returns relevant hits for "career vs biology tension"
 *       (semantic quality check against earlier indexed memories)
 *   S2  Memory writes complete in < 5s (perf sanity)
 *
 * Cost: ~3 supermemory writes + ~3 supermemory reads ≈ free tier no-op.
 *
 * Usage: npx tsx scripts/phase-8-evals.ts
 *        Exit code 0 = all hard criteria passed; non-zero = at least one failed.
 */

import { existsSync, readFileSync } from "node:fs";

// Optional .env.local — same pattern across all Phase 8 scripts.
// In CI / preview shells the env vars may already be exported, so a
// missing file is fine. The downstream env-var checks (e.g.
// SUPERMEMORY_API_KEY) catch the actual missing-config cases with
// clearer error messages than a raw ENOENT.
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

interface Result {
  id: string;
  description: string;
  hard: boolean;
  passed: boolean;
  detail: string;
}

const results: Result[] = [];

function record(
  id: string,
  description: string,
  hard: boolean,
  passed: boolean,
  detail: string,
) {
  results.push({ id, description, hard, passed, detail });
  const tag = hard ? "HARD" : "SOFT";
  const mark = passed ? "✓" : "✗";
  console.log(`  ${mark} [${tag}] ${id}  ${description}  — ${detail}`);
}

async function main() {
  const { db } = await import("../src/db");
  const { orgs, signals, agentConversations } = await import("../src/db/schema");
  const { eq, and, sql } = await import("drizzle-orm");
  const { buildOrcPromptContext } = await import(
    "../src/lib/orc/context-builder"
  );
  const { ORC_BUDGET } = await import("../src/lib/ai/token-count");
  const { getMemoryBackend } = await import("../src/lib/orc/memory");

  const [org] = await db.select().from(orgs).where(eq(orgs.slug, "blips"));
  if (!org) throw new Error("BLIPS org missing");

  // E3 specifically validates against the LEDGR signal (real-world
  // shape that tripped the production 413 bug). Pre-CodeRabbit-pass-2,
  // we silently fell back to the first signal in the DB if LEDGR was
  // missing — which let E3 pass/fail against unrelated data and
  // weakened the gate. Now we fail fast: if LEDGR isn't there, the
  // eval can't validate the contract it claims to and exits 1.
  const [ledgr] = await db
    .select()
    .from(signals)
    .where(and(eq(signals.shortcode, "LEDGR"), eq(signals.orgId, org.id)))
    .limit(1);
  if (!ledgr) {
    throw new Error(
      "LEDGR signal not found in DB. E3 ('LEDGR-shape signal fits inside 5k') needs this exact fixture; " +
        "either restore LEDGR or update the eval to point at the new fixture and document the change.",
    );
  }
  const fixtureSignal = ledgr;

  console.log(`\nUsing org=blips, signal=${fixtureSignal.shortcode}\n`);

  // ────────── E1, E2 — Compression triggers ──────────
  console.log("─── COMPRESSION ───");
  const mkMessages = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "orc") as "user" | "orc",
      content: `Message ${i + 1}: short content for eval`,
      ts: new Date(Date.now() - (n - i) * 1000).toISOString(),
    }));

  const ctx5 = buildOrcPromptContext({
    signal: fixtureSignal,
    messages: mkMessages(5),
    metadata: {},
    currentUserMessage: "test",
    activeStage: "BUNKER",
  });
  record(
    "E1a",
    "5 msgs → no compression",
    true,
    ctx5.needsSummarization === false,
    `needsSummarization=${ctx5.needsSummarization}`,
  );

  const ctx11 = buildOrcPromptContext({
    signal: fixtureSignal,
    messages: mkMessages(11),
    metadata: {},
    currentUserMessage: "test",
    activeStage: "BUNKER",
  });
  // E1b proves the COUNT-based trigger specifically — not just that
  // needsSummarization fired. needsSummarization is an OR of three
  // triggers (verbatimBreach || totalBreach || overCountCap), so a
  // naive boolean check could pass for the wrong reason and miss
  // count-path regressions. Since mkMessages produces SHORT content,
  // the verbatim and total token buckets stay well under their caps —
  // so if needsSummarization is true here, the count trigger must be
  // what fired. We assert: needsSummarization=true AND no token
  // breaches present in budget.breaches.
  const e1bCountTriggerOnly =
    ctx11.needsSummarization === true &&
    !ctx11.budget.breaches.includes("verbatim") &&
    !ctx11.budget.breaches.includes("total_input");
  record(
    "E1b",
    "11 msgs → COUNT-based trigger fires (token buckets uncrossed)",
    true,
    e1bCountTriggerOnly,
    `needsSummarization=${ctx11.needsSummarization} breaches=[${ctx11.budget.breaches.join(",")}]`,
  );

  const ctx20 = buildOrcPromptContext({
    signal: fixtureSignal,
    messages: mkMessages(20),
    metadata: {},
    currentUserMessage: "test",
    activeStage: "BUNKER",
  });
  // 20 msgs → verbatim should be capped at HARD_CAP=16 (not just window=10)
  record(
    "E2",
    "20 msgs → verbatim capped at HARD_CAP (no silent drop)",
    true,
    ctx20.parts.verbatim.length === 16,
    `verbatim.length=${ctx20.parts.verbatim.length} (expected 16)`,
  );

  // ────────── E3, E4 — Token budget ──────────
  console.log("\n─── TOKEN BUDGET ───");
  record(
    "E3",
    "LEDGR-shape signal fits inside 5k total budget",
    true,
    ctx5.budget.totalTokens <= ORC_BUDGET.total_input,
    `total=${ctx5.budget.totalTokens} (cap ${ORC_BUDGET.total_input})`,
  );
  record(
    "E4",
    "system_brand_signal stays under 2500-token bucket cap",
    true,
    ctx5.tokenEstimate.system_brand_signal <= ORC_BUDGET.system_brand_signal,
    `system_brand_signal=${ctx5.tokenEstimate.system_brand_signal} (cap ${ORC_BUDGET.system_brand_signal})`,
  );

  // ────────── E5, E6 — Memory write contract ──────────
  console.log("\n─── MEMORY WRITES ───");
  const memory = await getMemoryBackend();
  const evalStamp = `EVAL-${Date.now()}`;

  // E5 ACTUALLY exercises the events-container path the description
  // claims to validate (CodeRabbit pass 5: previously this wrote to
  // the test container, which left production events-path regressions
  // untested). To avoid permanent prod pollution, we write to events
  // and then immediately forget() the doc by id. The window between
  // write and delete is ~1-3s — small enough that production recall
  // is extremely unlikely to surface this transient eval data, and
  // the metadata.transient=true tag lets any consumer that does see
  // it filter it out. Cleanup runs in a finally so a mid-eval crash
  // still attempts the delete.
  const writeStart = Date.now();
  const eventsWrite = await memory.remember({
    orgId: org.id,
    container: "events",
    kind: "decision",
    content:
      `${evalStamp}: TRANSIENT EVAL WRITE — exercises events-container path; ` +
      `forget() called immediately after the assertion. Should never appear in production recall.`,
    metadata: {
      evalStamp,
      source: "phase-8-evals",
      transient: true,
    },
  });
  const writeMs = Date.now() - writeStart;
  try {
    record(
      "E5",
      "remember() events-container write returns non-empty id",
      true,
      eventsWrite.id.length > 0,
      `id=${eventsWrite.id.slice(0, 12)}… in ${writeMs}ms (events container — cleanup follows)`,
    );
  } finally {
    if (eventsWrite.id) {
      await memory.forget(eventsWrite.id);
    }
  }
  record(
    "S2",
    "Write completes in < 5s",
    false,
    writeMs < 5000,
    `${writeMs}ms`,
  );

  const testWrite = await memory.remember({
    orgId: org.id,
    container: "test",
    kind: "note",
    content: `${evalStamp}: Eval test write — test container, isolated.`,
    metadata: { evalStamp, source: "phase-8-evals" },
  });
  record(
    "E6",
    "remember() test-container returns non-empty id",
    true,
    testWrite.id.length > 0,
    `id=${testWrite.id.slice(0, 12)}…`,
  );

  // ────────── E7 — Recall returns [] not error on no matches ──────────
  console.log("\n─── RECALL CONTRACT ───");
  const noMatchHits = await memory.recall(
    "zzz_unlikely_query_string_no_matches_999",
    { orgId: org.id, limit: 5 },
  );
  record(
    "E7",
    "recall() returns [] (length=0, not throws) on no matches",
    true,
    Array.isArray(noMatchHits) && noMatchHits.length === 0,
    `isArray=${Array.isArray(noMatchHits)} length=${noMatchHits.length}`,
  );

  // ────────── E8 — Container isolation (with indexing wait) ──────────
  // Pre-CodeRabbit-pass-6, this just checked production recall
  // immediately after writing to test container. But supermemory's
  // async extraction takes 30-60s — so "no hit in prod" was
  // inconclusive: the test write might just not be searchable yet,
  // regardless of whether containers actually leak. False-pass risk.
  //
  // Now: write a dedicated isolation doc to test container, poll
  // test recall until it's findable (extraction complete), THEN
  // check production recall doesn't see it. If indexing doesn't
  // complete within the ceiling, we fail E8 honestly rather than
  // pass on inconclusive data. forget() in finally so we don't
  // leave the iso doc behind even on failure.
  const isolationStamp = `ISOLATION-${Date.now()}`;
  const isoWrite = await memory.remember({
    orgId: org.id,
    container: "test",
    kind: "note",
    content:
      `${isolationStamp}: Container isolation eval — should be findable via test recall ` +
      `but invisible to production recall. forget() called after the assertion.`,
    metadata: { isolationStamp, source: "phase-8-evals" },
  });

  try {
    // Poll test container until indexing completes (max 90s).
    let indexed = false;
    const maxWaitMs = 90_000;
    const pollIntervalMs = 5_000;
    const startWait = Date.now();
    while (Date.now() - startWait < maxWaitMs) {
      const testHits = await memory.recall(isolationStamp, {
        orgId: org.id,
        container: "test",
        limit: 5,
      });
      if (testHits.some((h) => h.content.includes(isolationStamp))) {
        indexed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    const waitedSec = Math.round((Date.now() - startWait) / 1000);

    if (!indexed) {
      // Indexing didn't complete — can't conclusively verify isolation.
      // Fail E8 rather than false-pass: we'd rather know a Phase 8K
      // regression slipped through than declare a clean run we
      // didn't actually verify.
      record(
        "E8",
        "Production recall does NOT see test-container writes (post-indexing)",
        true,
        false,
        `INCONCLUSIVE — test doc not indexed after ${waitedSec}s; can't verify isolation. Re-run after supermemory catches up, or raise maxWaitMs.`,
      );
    } else {
      // Indexing complete — now check production recall doesn't see it.
      const prodHits = await memory.recall(isolationStamp, {
        orgId: org.id,
        limit: 10,
        // container omitted → defaults to events + knowledge (production)
      });
      const leaked = prodHits.filter((h) =>
        h.content.includes(isolationStamp),
      );
      record(
        "E8",
        "Production recall does NOT see test-container writes (post-indexing)",
        true,
        leaked.length === 0,
        `indexed in ${waitedSec}s; prod leaks=${leaked.length}`,
      );
    }
  } finally {
    if (isoWrite.id) {
      await memory.forget(isoWrite.id);
    }
  }

  // ────────── S1 — Soft semantic quality check ──────────
  // Earlier sessions wrote a "career vs biology tension" memory in the
  // test container. If indexing has caught up, recall should find it.
  const semanticHits = await memory.recall(
    "career vs biology tension",
    { orgId: org.id, container: "test", limit: 5 },
  );
  record(
    "S1",
    "Semantic recall returns relevant hits",
    false,
    semanticHits.length > 0,
    `hits=${semanticHits.length}`,
  );

  // ────────── E9, E10 — Shortcode resolver ──────────
  console.log("\n─── SHORTCODE RESOLVER ───");
  // Use the REAL resolver from src/lib/signals/resolve-shortcode.ts —
  // pre-CodeRabbit-pass-1 we reimplemented the logic locally here, so
  // the eval would pass even if the runtime version diverged. Now we
  // import the same pure function the runtime uses (candidates.ts
  // calls it after building `taken` from a DB query), feed it a known
  // taken set, and assert the return is correct.
  const { resolveShortcode } = await import(
    "../src/lib/signals/resolve-shortcode"
  );

  // E9: base IS taken → resolver must return a DIFFERENT, unused
  // suffix. We force-build the precondition so the test isn't
  // dependent on what's currently in the DB.
  const base = "ROOTS";
  const e9Taken = new Set([base]); // base guaranteed taken
  const e9Resolved = resolveShortcode(base, e9Taken);
  record(
    "E9",
    "Shortcode resolver picks unused suffix when base taken",
    true,
    e9Taken.has(base) && e9Resolved !== base && !e9Taken.has(e9Resolved),
    `base=${base} taken=[${[...e9Taken].join(",")}] resolved=${e9Resolved}`,
  );

  // E10: base is FREE → resolver must return base unchanged.
  const uniqueBase = `EVAL${Date.now().toString(36).toUpperCase().slice(-4)}`;
  const e10Taken = new Set<string>(); // empty taken set → base is free
  const e10Resolved = resolveShortcode(uniqueBase, e10Taken);
  record(
    "E10",
    "Shortcode resolver returns base when free",
    true,
    !e10Taken.has(uniqueBase) && e10Resolved === uniqueBase,
    `base=${uniqueBase} taken=0 resolved=${e10Resolved}`,
  );

  // ────────── REPORT ──────────
  console.log("\n─── PHASE 8 EVAL RESULTS ───\n");
  const hard = results.filter((r) => r.hard);
  const soft = results.filter((r) => !r.hard);
  const hardPassed = hard.filter((r) => r.passed).length;
  const softPassed = soft.filter((r) => r.passed).length;
  console.log(`  HARD: ${hardPassed}/${hard.length} passed`);
  console.log(`  SOFT: ${softPassed}/${soft.length} passed (informational)`);

  if (hardPassed === hard.length) {
    console.log(
      `\n✓ Phase 8 evals passed. Branch is ready for PR + CodeRabbit + merge.`,
    );
  } else {
    console.log(
      `\n✗ ${hard.length - hardPassed} hard criteria failed. Investigate before opening PR.`,
    );
  }

  await db.$client.end();
  process.exit(hardPassed === hard.length ? 0 : 1);
}

main().catch((err) => {
  console.error("\n✗ Eval crashed:", err);
  process.exit(1);
});
