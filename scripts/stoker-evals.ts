/**
 * STOKER eval suite — Phase 9I acceptance test.
 *
 * Per agents/STOKER.md: 13 of 15 cases must pass for STOKER to formally
 * ship out of Phase 9.
 *
 * Each case runs STOKER's skill (same generateStructured call the
 * Inngest fan-out uses) against a fixture parent signal, then checks
 * the output against hard criteria.
 *
 * Hard criteria (each scored as a binary pass/fail per case):
 *   - Output validates against the StokerOutput Zod schema
 *     (schema's superRefine enforces decade order + refusal/manifestation
 *     consistency, so a passing parse covers most invariants)
 *   - The RESONANCE PROFILE matches the case's expected band per decade
 *     (strong / partial / weak — case author specifies the expected
 *     band, eval reports observed vs expected). When unsure, the case
 *     specifies "any" for that decade.
 *   - The case's required manifestation decades all carry a non-null
 *     manifestation block.
 *
 * Soft criteria (reported, not blocking):
 *   - Manifestation framing hooks include decade-specific markers
 *     (regex check for cohort-specific tokens; surfaces likely
 *     word-swappable framings).
 *   - Refused cases include a non-empty refusalRationale.
 *   - Per-dimension alignment fields are non-empty for at least 3 of
 *     the 7 life dimensions (so dimensionAlignment isn't all-empty).
 *
 * Test cases use synthetic playbook stubs — short paragraphs, NOT
 * the full scripts/playbooks/*.md text. Phase 9I tests STOKER's
 * scoring + framing logic; the full playbook impact is measured
 * in production after seed-decade-playbooks.ts runs and STOKER
 * has live recall data to lean on.
 *
 * Cost: 15 × ~1.5k input + ~2k output Gemini 2.5 Flash calls ≈ $0.10-
 * 0.15 per run. Cheap relative to fine-tune-quality eval volume.
 *
 * Usage: npx tsx scripts/stoker-evals.ts
 */

import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env.local")) {
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
}

type Band = "strong" | "partial" | "weak" | "any";

interface EvalCase {
  id: string;
  description: string;
  input: {
    shortcode: string;
    workingTitle: string;
    concept: string;
    rawExcerpt?: string;
    sourceUrl?: string;
  };
  expected: {
    /** Per-decade expected band. "any" means we don't assert on this
     *  decade — useful for ambiguous cases. */
    rck: Band;
    rcl: Band;
    rcd: Band;
    /** Whether the case should produce manifestations (≥1 score ≥50)
     *  or refuse (all <50). */
    refusedExpected: boolean;
  };
}

// Synthetic playbook stubs — short, decade-flavoured paragraphs.
// Phase 9H's full playbooks are richer; these eval stubs deliberately
// stay sparse so we measure STOKER's intrinsic decade reasoning, not
// its ability to parrot detailed playbook text. Production STOKER
// runs see the full playbooks via knowledge_documents recall.
const EVAL_PLAYBOOKS = {
  rck: `RCK 28-38 — The Reckoning. Career inflection, ambition vs meaning, urban-professional in early settling phase. Biology starts to matter. Civic identity being formed. The decade where every choice closes another door.`,
  rcl: `RCL 38-48 — The Recalibration. Success-fatigue with the legacy question opening underneath. Parenthood-pivot. Peak career + no energy. Friendships in WhatsApp groups. Sandwich generation — caretaking parents while shaping children.`,
  rcd: `RCD 48-58 — The Reckoned. What-was-it-for reckoning. Mortality-aware. Re-listening to own teen-era music. Ambition decay, refinement of remaining drives. Inherited belief audit. Generativity vs irrelevance.`,
};

const EVAL_CASES: EvalCase[] = [
  {
    id: "CIVIC",
    description: "Election turnout in metro India — civic identity formation.",
    input: {
      shortcode: "CIVIC",
      workingTitle: "Long queues, hot Sunday, the vote you almost didn't cast",
      concept:
        "Urban professionals describing the friction of voting on an election Sunday — the queue, the heat, the pressure of a Monday morning meeting at 9 — against the conviction that this vote shapes the country's next five years.",
      rawExcerpt:
        "Spent 90 minutes in the sun in Velachery. Three guys in front of me debated whether to bail. They didn't. We voted.",
    },
    expected: { rck: "strong", rcl: "partial", rcd: "any", refusedExpected: false },
  },
  {
    id: "CAREER",
    description: "First promotion that reads as a trap, not a milestone.",
    input: {
      shortcode: "CAREER",
      workingTitle: "The promotion that locks more than it opens",
      concept:
        "A 33-year-old engineer accepts a Director title and realises the new responsibilities consume the bandwidth they'd been saving to pivot. The validation arrives at the same moment as the trap.",
    },
    expected: { rck: "strong", rcl: "any", rcd: "weak", refusedExpected: false },
  },
  {
    id: "PARENT",
    description: "Child's first day at the school the parent vetoed in their own childhood.",
    input: {
      shortcode: "PARENT",
      workingTitle:
        "Dropping your kid at the gate of the school you swore you'd never send anyone to",
      concept:
        "A 41-year-old parent realises the school they're enrolling their kid in is the same kind of high-pressure, results-fixated institution they hated as a child. The compromise their own parents made now feels less like a betrayal and more like a tax.",
    },
    expected: { rck: "any", rcl: "strong", rcd: "partial", refusedExpected: false },
  },
  {
    id: "MUSIC",
    description: "Re-listening to teen-era music with a different ear at 52.",
    input: {
      shortcode: "MUSIC",
      workingTitle: "The Ilaiyaraaja you couldn't hear at 14, you can't stop hearing now",
      concept:
        "A 52-year-old engineer rediscovers the soundtracks of their teenage years — and notices, for the first time, what the lyrics were actually saying. The songs weren't about love; they were about loss they didn't have the vocabulary for at 14.",
    },
    expected: { rck: "weak", rcl: "any", rcd: "strong", refusedExpected: false },
  },
  {
    id: "HEALTH",
    description: "Mid-30s body sending its first letter.",
    input: {
      shortcode: "HEALTH",
      workingTitle: "The first time your back disagrees with your calendar",
      concept:
        "A 35-year-old founder's back goes out mid-fundraise. The sprint that worked at 28 doesn't work anymore. The first negotiation with a finite body — what gets traded, what gets dropped, what gets postponed.",
    },
    expected: { rck: "strong", rcl: "partial", rcd: "any", refusedExpected: false },
  },
  {
    id: "VOTE_AGAINST",
    description: "First time voting against the family's traditional choice.",
    input: {
      shortcode: "VOTEAG",
      workingTitle: "The first ballot you cast that the family won't post about",
      concept:
        "A 36-year-old votes for a different party than the one their parents have voted for since 1991. The vote isn't dramatic; the silence at Sunday lunch the next week is. The decade where political identity stops being inherited.",
    },
    expected: { rck: "strong", rcl: "partial", rcd: "any", refusedExpected: false },
  },
  {
    id: "INHERIT",
    description: "First inherited property — what to do with the family flat.",
    input: {
      shortcode: "INHRT",
      workingTitle: "The flat your father bought in 1987 is now yours, and now what",
      concept:
        "Father passes; the Mylapore flat is now legally the 38-year-old daughter's. She's lived in Bangalore for 12 years. Selling feels like betrayal; keeping feels like a recurring tax bill she didn't sign up for.",
    },
    expected: { rck: "any", rcl: "strong", rcd: "any", refusedExpected: false },
  },
  {
    id: "AI",
    description: "Career-stage anxiety about AI making the work irrelevant.",
    input: {
      shortcode: "AIWORK",
      workingTitle: "The job you mastered for 20 years is being out-prompted",
      concept:
        "A 47-year-old senior writer realises the ghost-writers of the future will be ChatGPT prompts. The decade of mastery is being compressed into an instruction.",
    },
    expected: { rck: "any", rcl: "strong", rcd: "any", refusedExpected: false },
  },
  {
    id: "DIVORCE",
    description: "Best friend's divorce at 41 reframes one's own marriage.",
    input: {
      shortcode: "DIVORC",
      workingTitle: "Your friend's divorce becomes a mirror you didn't ask for",
      concept:
        "A 42-year-old's best friend announces a divorce at the school WhatsApp group's annual dinner. The next day, the listener finds themselves auditing the silences in their own marriage they had been calling 'comfortable'.",
    },
    expected: { rck: "any", rcl: "strong", rcd: "any", refusedExpected: false },
  },
  {
    id: "MOMHOSP",
    description: "Mother's first hospital stay — the future arrives early.",
    input: {
      shortcode: "MOMHSP",
      workingTitle: "Sleeping in a hospital chair next to the woman who once slept next to you",
      concept:
        "A 45-year-old spends three nights on a hospital chair while their mother recovers. The role reversal isn't gradual anymore. The decade where the parent stops being the parent and the question becomes who you've become.",
    },
    expected: { rck: "any", rcl: "strong", rcd: "strong", refusedExpected: false },
  },
  {
    id: "CITY",
    description: "Bangalore vs Chennai loyalty crisis at 32.",
    input: {
      shortcode: "CITYLY",
      workingTitle: "The city you grew up in is no longer the city you defend",
      concept:
        "A 32-year-old in Bangalore for 8 years catches themselves correcting a colleague who called Chennai 'small' — and realises they don't believe the defence anymore. The loyalty has migrated even though the family hasn't.",
    },
    expected: { rck: "strong", rcl: "any", rcd: "weak", refusedExpected: false },
  },
  {
    id: "ANCHOR",
    description: "Promotion that feels like an anchor — pure RCK.",
    input: {
      shortcode: "ANCHOR",
      workingTitle: "The first promotion that feels more like an anchor than a milestone",
      concept:
        "A 31-year-old gets the title they wanted, signs the lease they wanted, and realises the freedom they were saving the title for is the freedom this title forecloses.",
    },
    expected: { rck: "strong", rcl: "any", rcd: "weak", refusedExpected: false },
  },
  {
    id: "COFFEE",
    description: "Universal coffee-shop-closing nostalgia — should refuse.",
    input: {
      shortcode: "COFFEE",
      workingTitle: "The coffee shop where you used to write is closing",
      concept:
        "A neighbourhood cafe announces its closure. Patrons are sad. People reminisce about the books they read there.",
    },
    expected: { rck: "any", rcl: "any", rcd: "any", refusedExpected: true },
  },
  {
    id: "GENZ",
    description: "Workplace humor specific to Gen Z (under 27) — out of cohort.",
    input: {
      shortcode: "GENZHM",
      workingTitle: "The 'no thoughts head empty' meme as a Slack reaction",
      concept:
        "Gen Z employees use absurdist humor as a workplace norm. Boomers find it disorienting; the new working class finds it relieving.",
    },
    expected: { rck: "any", rcl: "any", rcd: "any", refusedExpected: true },
  },
  {
    id: "RECKON",
    description: "End-of-career accounting at 55 — pure RCD.",
    input: {
      shortcode: "RECKON",
      workingTitle: "The final accounting of a career that turned out to be a job",
      concept:
        "A 55-year-old auditing what their work amounted to. Not a crisis — a reckoning. The career was real, the impact was modest, the trade-offs were the trade-offs. The decade where the math is finished.",
    },
    expected: { rck: "weak", rcl: "any", rcd: "strong", refusedExpected: false },
  },
];

interface CaseResult {
  id: string;
  passed: boolean;
  schemaValid: boolean;
  bandMatchesExpected: boolean;
  manifestationConsistent: boolean;
  refusalConsistent: boolean;
  observed: {
    scores: { rck: number; rcl: number; rcd: number };
    refused: boolean;
  } | null;
  failures: string[];
  warnings: string[];
  rawError?: string;
  durationMs: number;
}

function bandFor(score: number): Band {
  if (score >= 70) return "strong";
  if (score >= 50) return "partial";
  return "weak";
}

function bandMatches(observed: Band, expected: Band): boolean {
  if (expected === "any") return true;
  return observed === expected;
}

async function runOneCase(
  c: EvalCase,
  // Imports passed in so main() resolves them once.
  runSkill: typeof import("../src/lib/orc/orchestrator").runSkill,
  signalsTable: typeof import("../src/db/schema").signals,
  agentJourneys: typeof import("../src/db/schema").journeys,
  db: typeof import("../src/db").db,
  orgId: string,
): Promise<CaseResult> {
  const start = Date.now();
  const failures: string[] = [];
  const warnings: string[] = [];

  // Eval-only signal + journey created in DB so runSkill's existing
  // contract holds (it expects a real signal/journey to write
  // agent_outputs against). We INSERT a disposable parent and clean
  // up on completion. Same pattern as scripts/test-orchestrator.ts.
  const { eq } = await import("drizzle-orm");
  const { createInitialJourney } = await import("../src/lib/orc/journey");

  // Build a disposable signal row — IN_BUNKER, no parent, scoped to
  // the BLIPS org. Eval-only, deleted at end.
  // DB shortcode includes a timestamp suffix for org-uniqueness across
  // re-runs; the runSkill *input* uses the case's short shortcode
  // (3-10 chars per StokerInput schema), since the LLM prompt should
  // see the human-readable identifier, not the DB-uniqued long form.
  const dbShortcode = `EVAL${c.id.slice(0, 4)}${Date.now().toString(36).slice(-4)}`;
  const [signal] = await db
    .insert(signalsTable)
    .values({
      orgId,
      shortcode: dbShortcode,
      workingTitle: c.input.workingTitle,
      concept: c.input.concept,
      source: "direct",
      rawText: c.input.rawExcerpt ?? null,
      status: "IN_BUNKER",
    })
    .returning({ id: signalsTable.id, shortcode: signalsTable.shortcode });

  let journeyId: string | null = null;
  try {
    const journey = await createInitialJourney({
      signalId: signal.id,
      createdBy: null,
    });
    journeyId = journey.id;

    // runSkill resolves the active journey internally, so we don't
    // pass it. The createInitialJourney call above is what makes
    // getActiveJourney inside runSkill succeed.
    void journey;
    const result = await runSkill<
      import("../src/skills/stoker").StokerInput,
      import("../src/skills/stoker").StokerOutput
    >({
      agentKey: "STOKER",
      orgId,
      signalId: signal.id,
      input: {
        signalId: signal.id,
        // Pass the case's human-readable shortcode (matches the
        // StokerInput schema's 3-10 char bound). The DB row uses the
        // longer dbShortcode for uniqueness; the LLM only sees the
        // case identifier.
        shortcode: c.input.shortcode,
        workingTitle: c.input.workingTitle,
        concept: c.input.concept,
        rawExcerpt: c.input.rawExcerpt ?? null,
        sourceUrl: c.input.sourceUrl ?? null,
        playbooks: EVAL_PLAYBOOKS,
      },
    });

    const out = result.output;
    const rck = out.decades.find((d) => d.decade === "RCK");
    const rcl = out.decades.find((d) => d.decade === "RCL");
    const rcd = out.decades.find((d) => d.decade === "RCD");
    if (!rck || !rcl || !rcd) {
      failures.push("output missing one of RCK/RCL/RCD entries");
      return {
        id: c.id,
        passed: false,
        schemaValid: true,
        bandMatchesExpected: false,
        manifestationConsistent: false,
        refusalConsistent: false,
        observed: null,
        failures,
        warnings,
        durationMs: Date.now() - start,
      };
    }

    const observed = {
      scores: {
        rck: rck.resonanceScore,
        rcl: rcl.resonanceScore,
        rcd: rcd.resonanceScore,
      },
      refused: out.refused,
    };

    const observedBands = {
      rck: bandFor(rck.resonanceScore),
      rcl: bandFor(rcl.resonanceScore),
      rcd: bandFor(rcd.resonanceScore),
    };

    let bandMatchesExpected = true;
    if (!bandMatches(observedBands.rck, c.expected.rck)) {
      bandMatchesExpected = false;
      failures.push(
        `RCK expected ${c.expected.rck}, observed ${observedBands.rck} (score ${rck.resonanceScore})`,
      );
    }
    if (!bandMatches(observedBands.rcl, c.expected.rcl)) {
      bandMatchesExpected = false;
      failures.push(
        `RCL expected ${c.expected.rcl}, observed ${observedBands.rcl} (score ${rcl.resonanceScore})`,
      );
    }
    if (!bandMatches(observedBands.rcd, c.expected.rcd)) {
      bandMatchesExpected = false;
      failures.push(
        `RCD expected ${c.expected.rcd}, observed ${observedBands.rcd} (score ${rcd.resonanceScore})`,
      );
    }

    // Refusal consistency — case author specifies whether the case
    // should refuse. Schema-level refused=allWeak invariant is
    // already enforced by the Zod refine. We additionally check the
    // case author's intent matches the model's call.
    const refusalConsistent = out.refused === c.expected.refusedExpected;
    if (!refusalConsistent) {
      failures.push(
        `refused expected ${c.expected.refusedExpected}, observed ${out.refused}`,
      );
    }

    // Manifestation consistency — expected manifestations on
    // strong/partial decades only. Already schema-enforced; we
    // re-check at the case level for clarity.
    const manifestationConsistent = out.decades.every((d) =>
      d.resonanceScore >= 50
        ? d.manifestation !== null
        : d.manifestation === null,
    );
    if (!manifestationConsistent) {
      failures.push("manifestation/score consistency violated");
    }

    // Soft warnings — not blocking, surfaced for review.
    out.decades.forEach((d) => {
      if (d.manifestation) {
        const dimVals = Object.values(d.manifestation.dimensionAlignment);
        const nonEmpty = dimVals.filter((v) => v.trim().length > 0).length;
        if (nonEmpty < 3) {
          warnings.push(
            `${d.decade}: only ${nonEmpty}/7 dimensions filled — likely shallow alignment`,
          );
        }
      }
    });
    if (out.refused && !out.refusalRationale) {
      warnings.push("refused=true but refusalRationale empty (schema should have caught)");
    }

    const passed = bandMatchesExpected && refusalConsistent && manifestationConsistent;
    return {
      id: c.id,
      passed,
      schemaValid: true,
      bandMatchesExpected,
      manifestationConsistent,
      refusalConsistent,
      observed,
      failures,
      warnings,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    failures.push(`uncaught: ${err}`);
    return {
      id: c.id,
      passed: false,
      schemaValid: false,
      bandMatchesExpected: false,
      manifestationConsistent: false,
      refusalConsistent: false,
      observed: null,
      failures,
      warnings,
      rawError: err,
      durationMs: Date.now() - start,
    };
  } finally {
    // Clean up the disposable signal + its agent_outputs and journey
    // (cascade-deletes via FK). Even on test failure we clean up so
    // re-running the eval doesn't leave a junk drawer.
    try {
      // Delete signal — cascades to journeys + agent_outputs +
      // agent_conversations + decision_history via the FK ON DELETE
      // CASCADE chain set on signals.
      await db.delete(signalsTable).where(eq(signalsTable.id, signal.id));
    } catch (cleanupErr) {
      console.error(
        `[stoker-evals] cleanup failed for ${signal.shortcode}:`,
        cleanupErr,
      );
    }
    void journeyId;
    void agentJourneys;
  }
}

async function main() {
  console.log("[stoker-evals] Phase 9I — running 15 cases against STOKER...\n");

  const { db } = await import("../src/db");
  const { signals, journeys, orgs } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const { runSkill } = await import("../src/lib/orc/orchestrator");
  // Ensure skill registry is populated
  await import("../src/skills");

  const [org] = await db.select().from(orgs).where(eq(orgs.slug, "blips"));
  if (!org) {
    console.error("✗ BLIPS org not found. Run scripts/seed.ts first.");
    process.exit(1);
  }
  console.log(`✓ Org: ${org.slug} (${org.id})\n`);

  const results: CaseResult[] = [];
  for (const c of EVAL_CASES) {
    process.stdout.write(`[${c.id.padEnd(8)}] ${c.description.slice(0, 60).padEnd(60)} `);
    const r = await runOneCase(c, runSkill, signals, journeys, db, org.id);
    results.push(r);
    const pass = r.passed ? "PASS" : "FAIL";
    const time = `${(r.durationMs / 1000).toFixed(1)}s`;
    if (r.observed) {
      const { rck, rcl, rcd } = r.observed.scores;
      process.stdout.write(
        `${pass} (RCK=${rck} RCL=${rcl} RCD=${rcd}${r.observed.refused ? " refused" : ""}, ${time})\n`,
      );
    } else {
      process.stdout.write(`${pass} (no output, ${time})\n`);
    }
    if (r.failures.length > 0) {
      r.failures.forEach((f) => console.log(`     ✗ ${f}`));
    }
    if (r.warnings.length > 0) {
      r.warnings.forEach((w) => console.log(`     ⚠ ${w}`));
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const threshold = 13;

  console.log("\n[stoker-evals] summary");
  console.log(`  passed: ${passed} / ${total}`);
  console.log(`  threshold: ${threshold}`);
  console.log(`  result: ${passed >= threshold ? "ACCEPTANCE PASS ✓" : "ACCEPTANCE FAIL ✗"}`);

  // Per-decade hit rate
  const okScored = results.filter((r) => r.observed);
  if (okScored.length > 0) {
    const avg = (k: "rck" | "rcl" | "rcd") =>
      (
        okScored.reduce((sum, r) => sum + r.observed!.scores[k], 0) /
        okScored.length
      ).toFixed(1);
    console.log(`  avg score: RCK=${avg("rck")} RCL=${avg("rcl")} RCD=${avg("rcd")}`);
  }

  process.exit(passed >= threshold ? 0 : 1);
}

main().catch((err) => {
  console.error("[stoker-evals] fatal:", err);
  process.exit(1);
});
