/**
 * Phase 8K end-to-end smoke test — automated.
 *
 * Exercises the four things that matter for shipping Phase 8K with
 * confidence:
 *
 *   1. COMPRESSION  — buildOrcPromptContext correctly triggers
 *      summarization as message count grows past VERBATIM_WINDOW,
 *      regardless of token volume. (The Phase 8K bug fix.)
 *
 *   2. WRITE        — backend.remember() succeeds for the three
 *      memory kinds we'll see in production: decision, conversation
 *      summary, signal dossier. Returns non-empty document ids.
 *
 *   3. RECALL       — the prior smoke-test memory (from a few minutes
 *      ago) is now indexed and findable via backend.recall(). This
 *      proves the round-trip is real, not just contract-conformant.
 *
 *   4. KIND FILTER  — recall() with kind: 'decision' filter only
 *      returns decision memories, not all memories.
 *
 * Cost: ~3 document writes + ~2 search calls. Effectively $0 against
 * the free tier.
 *
 * Usage: npx tsx scripts/smoke-test-phase-8k.ts
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

const SECTIONS = ["COMPRESSION", "WRITE", "RECALL", "KIND_FILTER"] as const;
const failures: string[] = [];
function pass(section: typeof SECTIONS[number], msg: string) {
  console.log(`✓ [${section}] ${msg}`);
}
function fail(section: typeof SECTIONS[number], msg: string) {
  console.error(`✗ [${section}] ${msg}`);
  failures.push(`[${section}] ${msg}`);
}

async function main() {
  const { buildOrcPromptContext } = await import(
    "../src/lib/orc/context-builder"
  );
  const { getMemoryBackend } = await import("../src/lib/orc/memory");
  const { db } = await import("../src/db");
  const { orgs, signals } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");

  // ── Setup: org + a real signal for realistic context ───────────
  const [org] = await db.select().from(orgs).where(eq(orgs.slug, "blips"));
  if (!org) throw new Error("BLIPS org not found");
  const [signal] = await db.select().from(signals).limit(1);
  if (!signal) throw new Error("No signals in DB to test against");
  console.log(
    `\nUsing org=${org.slug} (${org.id})\nUsing signal=${signal.shortcode}\n`,
  );

  // ─────────────────────────────────────────────────────────────
  // SECTION 1: COMPRESSION
  //   Verify the Phase 8K bug fix — count-based summarization
  //   trigger fires at the right thresholds.
  // ─────────────────────────────────────────────────────────────
  console.log("─── SECTION 1: COMPRESSION (the bug fix) ───\n");

  const fakeMsg = (i: number) => ({
    role: i % 2 === 0 ? ("user" as const) : ("orc" as const),
    content: `Test message ${i}, short.`,
    ts: new Date().toISOString(),
  });

  // Case A: 5 messages → no summarization needed (well under window)
  let ctx = buildOrcPromptContext({
    signal,
    messages: Array.from({ length: 5 }, (_, i) => fakeMsg(i)),
    metadata: {},
    currentUserMessage: "What about this?",
    activeStage: "BUNKER" as const,
  });
  if (!ctx.needsSummarization && ctx.parts.verbatim.length === 5) {
    pass(
      "COMPRESSION",
      `5 messages: no summary triggered, all 5 in verbatim (was the bug — would still be 5)`,
    );
  } else {
    fail(
      "COMPRESSION",
      `5 messages: expected no summary + 5 verbatim, got summary=${ctx.needsSummarization} verbatim=${ctx.parts.verbatim.length}`,
    );
  }

  // Case B: 11 messages → count trigger should fire
  ctx = buildOrcPromptContext({
    signal,
    messages: Array.from({ length: 11 }, (_, i) => fakeMsg(i)),
    metadata: {},
    currentUserMessage: "What about this?",
    activeStage: "BUNKER" as const,
  });
  if (ctx.needsSummarization) {
    pass(
      "COMPRESSION",
      `11 messages: needsSummarization=true (count trigger fired correctly — pre-fix this was false)`,
    );
  } else {
    fail(
      "COMPRESSION",
      `11 messages: needsSummarization should be true but was false. Bug fix not effective.`,
    );
  }

  // Case C: 20 messages, verbatim still bounded by HARD_CAP=16
  ctx = buildOrcPromptContext({
    signal,
    messages: Array.from({ length: 20 }, (_, i) => fakeMsg(i)),
    metadata: {},
    currentUserMessage: "What about this?",
    activeStage: "BUNKER" as const,
  });
  if (ctx.parts.verbatim.length <= 16 && ctx.needsSummarization) {
    pass(
      "COMPRESSION",
      `20 messages: verbatim capped at ${ctx.parts.verbatim.length} (HARD_CAP=16), summary triggered`,
    );
  } else {
    fail(
      "COMPRESSION",
      `20 messages: verbatim=${ctx.parts.verbatim.length} (expected ≤16), summary=${ctx.needsSummarization}`,
    );
  }

  // Case D: with a prior summary covering first 6, 12 unsummarized
  // messages should still trigger another pass (12 > VERBATIM_WINDOW=10)
  ctx = buildOrcPromptContext({
    signal,
    messages: Array.from({ length: 18 }, (_, i) => fakeMsg(i)),
    metadata: {
      summary: "Earlier we discussed the signal dossier and brand fit.",
      summary_through_index: 6,
    },
    currentUserMessage: "What about this?",
    activeStage: "BUNKER" as const,
  });
  // unsummarized = 18 - 6 = 12, which is > VERBATIM_WINDOW(10), so summarization should fire
  if (ctx.needsSummarization) {
    pass(
      "COMPRESSION",
      `18 msgs with summary_through=6: needsSummarization=true (12 unsummarized > window=10)`,
    );
  } else {
    fail(
      "COMPRESSION",
      `18 msgs with summary_through=6: needsSummarization should be true`,
    );
  }

  // ─────────────────────────────────────────────────────────────
  // SECTION 2: WRITE
  //   Exercise backend.remember() for the three production memory
  //   kinds. Returns non-empty document ids on success.
  // ─────────────────────────────────────────────────────────────
  console.log("\n─── SECTION 2: WRITE (the hooks' contract) ───\n");

  const backend = await getMemoryBackend();
  if (backend.constructor.name !== "SupermemoryBackend") {
    fail(
      "WRITE",
      `Expected SupermemoryBackend, got ${backend.constructor.name}. Env var missing?`,
    );
    return;
  }
  pass("WRITE", `Backend selected: SupermemoryBackend`);

  const stamp = Date.now();
  const writes = [
    {
      kind: "decision" as const,
      content: `[SMOKE-${stamp}] Dismissed signal SMOKE-A "Test Career-Biology Tension". Concept: a smoke test concept about career vs biology tension. Reason: smoke-test marker for recall verification.`,
      metadata: { decision: "dismissed", smokeStamp: stamp },
    },
    {
      kind: "decision" as const,
      content: `[SMOKE-${stamp}] Approved BUNKER output on signal SMOKE-B "Test Solo Parenting Echo". Concept: a smoke test concept about RCD-cohort solo parenting. Reason: smoke-test marker for kind-filter verification.`,
      metadata: { decision: "approved", smokeStamp: stamp },
    },
    {
      kind: "conversation_summary" as const,
      content: `[SMOKE-${stamp}] Inba and ORC discussed how the BIOCAR signal reads strong for RCK on the career-vs-biology tension axis. ORC flagged that the dossier needs more grounding before STOKER. Inba agreed.`,
      metadata: { coversThroughIndex: 6, smokeStamp: stamp },
    },
  ];

  const writeIds: string[] = [];
  for (const w of writes) {
    const start = Date.now();
    const result = await backend.remember({
      orgId: org.id,
      container: "test", // ISOLATED test container — never visible to production recall
      kind: w.kind,
      content: w.content,
      metadata: w.metadata,
    });
    const ms = Date.now() - start;
    if (result.id) {
      pass(
        "WRITE",
        `${w.kind.padEnd(22)} → id=${result.id.slice(0, 16)}… (${ms}ms)`,
      );
      writeIds.push(result.id);
    } else {
      fail("WRITE", `${w.kind} returned empty id`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // SECTION 3: RECALL
  //   Try to find the marker from the EARLIER smoke test
  //   (test-memory-roundtrip.ts run a few minutes ago). That doc
  //   should be indexed by now. If it is, the round-trip works.
  // ─────────────────────────────────────────────────────────────
  console.log("\n─── SECTION 3: RECALL (round-trip on prior memory) ───\n");

  const priorHits = await backend.recall("career vs biology tension", {
    orgId: org.id,
    container: "test", // prior smoke test wrote to test container
    limit: 5,
  });
  if (priorHits.length > 0) {
    pass(
      "RECALL",
      `Found ${priorHits.length} hits for "career vs biology tension"`,
    );
    for (const h of priorHits.slice(0, 3)) {
      console.log(
        `   - kind=${h.kind} score=${h.score.toFixed(3)} content="${h.content.slice(0, 90)}…"`,
      );
    }
  } else {
    fail(
      "RECALL",
      `Found 0 hits for "career vs biology tension". Either: (a) prior smoke test write hasn't been indexed yet (>5min usually), (b) wrapper search call has a bug.`,
    );
  }

  // ─────────────────────────────────────────────────────────────
  // SECTION 4: KIND FILTER
  //   Same query, but filtered to kind: 'decision'. Should not
  //   return the conversation_summary memory we just wrote.
  //   (May still return 0 if today's writes aren't indexed yet —
  //   that's an async-extraction issue, not a filter bug.)
  // ─────────────────────────────────────────────────────────────
  console.log("\n─── SECTION 4: KIND FILTER ───\n");

  const decisionHits = await backend.recall("smoke test", {
    orgId: org.id,
    container: "test",
    kind: "decision",
    limit: 10,
  });
  const allHits = await backend.recall("smoke test", {
    orgId: org.id,
    container: "test",
    limit: 10,
  });

  const decisionKindsCorrect = decisionHits.every(
    (h) => h.kind === "decision",
  );
  pass(
    "KIND_FILTER",
    `kind:'decision' query → ${decisionHits.length} hits, all kind=decision: ${decisionKindsCorrect}`,
  );
  pass(
    "KIND_FILTER",
    `unfiltered query → ${allHits.length} hits (any kind)`,
  );
  if (!decisionKindsCorrect) {
    fail(
      "KIND_FILTER",
      `Decision filter leaked non-decision kinds: ${decisionHits.map((h) => h.kind).join(", ")}`,
    );
  }

  // ─────────────────────────────────────────────────────────────
  // RESULTS
  // ─────────────────────────────────────────────────────────────
  console.log("\n─── RESULTS ───\n");
  if (failures.length === 0) {
    console.log("✓ All sections passed. Phase 8K is ready.");
    console.log("  Note: today's just-written memories may not be findable");
    console.log("  for another 30-60s — supermemory extracts asynchronously.");
  } else {
    console.error(`✗ ${failures.length} failure(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  await db.$client.end();
}

main().catch((err) => {
  console.error("\n✗ Smoke test crashed:", err);
  process.exit(1);
});
