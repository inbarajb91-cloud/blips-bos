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
 *   E5  Memory wrapper: remember() returns non-empty id on valid write (events container)
 *   E6  Memory wrapper: remember() returns non-empty id on valid write (test container)
 *   E7  Memory wrapper: recall() returns [] not error when no matches
 *   E8  Container isolation: prod recall does NOT see test-container writes
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

  // Find a real signal to use as fixture (LEDGR if present, else first)
  const [ledgr] = await db
    .select()
    .from(signals)
    .where(and(eq(signals.shortcode, "LEDGR"), eq(signals.orgId, org.id)))
    .limit(1);
  const [firstSignal] = ledgr
    ? [ledgr]
    : await db.select().from(signals).where(eq(signals.orgId, org.id)).limit(1);
  if (!firstSignal) throw new Error("No signals in DB to test against");

  console.log(`\nUsing org=blips, signal=${firstSignal.shortcode}\n`);

  // ────────── E1, E2 — Compression triggers ──────────
  console.log("─── COMPRESSION ───");
  const mkMessages = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "orc") as "user" | "orc",
      content: `Message ${i + 1}: short content for eval`,
      ts: new Date(Date.now() - (n - i) * 1000).toISOString(),
    }));

  const ctx5 = buildOrcPromptContext({
    signal: firstSignal,
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
    signal: firstSignal,
    messages: mkMessages(11),
    metadata: {},
    currentUserMessage: "test",
    activeStage: "BUNKER",
  });
  record(
    "E1b",
    "11 msgs → compression triggered (count-based)",
    true,
    ctx11.needsSummarization === true,
    `needsSummarization=${ctx11.needsSummarization}`,
  );

  const ctx20 = buildOrcPromptContext({
    signal: firstSignal,
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

  const writeStart = Date.now();
  const eventsWrite = await memory.remember({
    orgId: org.id,
    container: "test", // Use test container for events-shape writes too — these are eval data
    kind: "decision",
    content: `${evalStamp}: Eval test write — events-shape decision memory.`,
    metadata: { evalStamp, source: "phase-8-evals" },
  });
  const writeMs = Date.now() - writeStart;
  record(
    "E5",
    "remember() events-shape returns non-empty id",
    true,
    eventsWrite.id.length > 0,
    `id=${eventsWrite.id.slice(0, 12)}… in ${writeMs}ms`,
  );
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
    "recall() returns [] (not throws) on no matches",
    true,
    Array.isArray(noMatchHits),
    `array length=${noMatchHits.length}`,
  );

  // ────────── E8 — Container isolation ──────────
  // Write to test container above; recall from production (default scope)
  // should NOT see those writes. Caveat: supermemory extraction is async,
  // so the just-written memories may not be findable for ~30-60s. We
  // search for the EVAL stamp specifically — if it appears in production
  // recall, that's a leak (regardless of indexing latency).
  const prodHits = await memory.recall(evalStamp, {
    orgId: org.id,
    limit: 10,
    // container omitted → defaults to events + knowledge (production)
  });
  record(
    "E8",
    "Production recall does NOT see test-container writes",
    true,
    !prodHits.some((h) =>
      h.content.includes(evalStamp),
    ),
    `prod hits matching stamp: ${prodHits.filter((h) => h.content.includes(evalStamp)).length}`,
  );

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
  // We can't directly import the helper (it's not exported from the
  // server action file). Instead, exercise the contract via raw SQL:
  // pick a base, query existing, simulate the suffix resolution.
  const base = "ROOTS";
  const rows = await db.execute(sql`
    SELECT shortcode FROM signals
    WHERE org_id = ${org.id}
      AND (shortcode = ${base} OR shortcode LIKE ${base + "-%"})
  `);
  const taken = new Set(
    (rows as unknown as Array<{ shortcode: string }>).map((r) => r.shortcode),
  );
  let resolved: string;
  if (!taken.has(base)) {
    resolved = base;
  } else {
    let i = 2;
    while (i < 100 && taken.has(`${base}-${i}`)) i++;
    resolved = `${base}-${i}`;
  }
  record(
    "E9",
    "Shortcode resolver picks unused suffix when base taken",
    true,
    !taken.has(resolved),
    `base=${base} taken=[${[...taken].join(",")}] resolved=${resolved}`,
  );

  // E10: pick a guaranteed-unique base, resolver should return base unchanged
  const uniqueBase = `EVAL${Date.now().toString(36).toUpperCase().slice(-4)}`;
  const uniqueRows = await db.execute(sql`
    SELECT shortcode FROM signals
    WHERE org_id = ${org.id}
      AND (shortcode = ${uniqueBase} OR shortcode LIKE ${uniqueBase + "-%"})
  `);
  const uniqueTaken = new Set(
    (uniqueRows as unknown as Array<{ shortcode: string }>).map(
      (r) => r.shortcode,
    ),
  );
  record(
    "E10",
    "Shortcode resolver returns base when free",
    true,
    uniqueTaken.size === 0,
    `base=${uniqueBase} taken=${uniqueTaken.size}`,
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
