/**
 * Verify the F4 mutation-intent classifier against live Gemini Flash.
 *
 * Exercises 12 cases — 6 expected true (real mutation requests) and
 * 6 expected false (mentions / discussions / non-actions). The false
 * set is the killer — these are the exact phrasings the old regex
 * falsely matched and the new classifier is supposed to filter.
 *
 * Run: pnpm tsx --env-file=.env.local scripts/verify-mutation-intent.ts
 */

import { classifyMutationIntent } from "@/lib/orc/mutation-intent";

interface Case {
  message: string;
  expected: boolean;
  rationale: string;
}

const cases: Case[] = [
  // ── EXPECTED TRUE: real mutation requests ─────────────────────────
  {
    message: "approve it",
    expected: true,
    rationale: "direct imperative",
  },
  {
    message: "Approve & advance to ENGINE please",
    expected: true,
    rationale: "explicit approve+advance request",
  },
  {
    message: "regenerate the typography section",
    expected: true,
    rationale: "explicit regen request scoped to a section",
  },
  {
    message: "dismiss this gallery, the variants are off",
    expected: true,
    rationale: "explicit dismiss request",
  },
  {
    message: "finalize the current draft at high tier",
    expected: true,
    rationale: "BOILER v2 finalize action",
  },
  {
    message: "discard the oldest version, it's not useful",
    expected: true,
    rationale: "explicit discard request",
  },

  // ── EXPECTED FALSE: the regex's false-positive zoo ────────────────
  {
    message: "I approve of the framing — can you draft a section about that?",
    expected: false,
    rationale: "'approve of' is sentiment, not action",
  },
  {
    message: "what does the approve & advance button actually do?",
    expected: false,
    rationale: "question about the action, not a request",
  },
  {
    message:
      "the founder team rejected this last week — can you summarize why?",
    expected: false,
    rationale: "describing a past decision, not requesting one",
  },
  {
    message:
      "this section reads a bit off — the typography feels mismatched to the framing",
    expected: false,
    rationale: "feedback without action request",
  },
  {
    message: "should I edit the framing or leave it as-is?",
    expected: false,
    rationale: "asking for advice, not requesting edit",
  },
  {
    message:
      "explain how the regenerate-section flow works under the hood — when does the cascade banner show?",
    expected: false,
    rationale: "asking about mechanism, not requesting regen",
  },
];

interface Result {
  case: Case;
  actual: boolean;
  durationMs: number;
  errorMessage?: string;
}

async function main() {
  console.log("verify-mutation-intent — 12 cases against live gemini-2.5-flash\n");
  const results: Result[] = [];

  for (const c of cases) {
    process.stdout.write(`  ${c.expected ? "+" : "-"} ${JSON.stringify(c.message).slice(0, 80)}\n    `);
    const r = await classifyMutationIntent(c.message);
    results.push({
      case: c,
      actual: r.mutationRequested,
      durationMs: r.durationMs,
      errorMessage: r.errorMessage,
    });
    const ok = r.mutationRequested === c.expected;
    console.log(
      `${ok ? "PASS" : "FAIL"} — expected ${c.expected}, got ${r.mutationRequested} (${r.durationMs}ms)${r.errorMessage ? " [classifier errored]" : ""}`,
    );
    if (!ok) console.log(`    rationale: ${c.rationale}`);
  }

  const passed = results.filter((r) => r.actual === r.case.expected).length;
  const total = results.length;
  const avgMs = Math.round(
    results.reduce((a, r) => a + r.durationMs, 0) / results.length,
  );
  console.log(
    `\n${passed}/${total} passed  ·  avg classifier latency: ${avgMs}ms  ·  threshold: ${total} (zero false positives or negatives)`,
  );

  if (passed !== total) {
    console.log("\nFAIL — at least one case misclassified. Review classifier prompt.");
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
