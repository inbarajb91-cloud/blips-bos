import { z } from "zod";
import type { Skill } from "./types";
import { registerSkill } from "./registry";

/**
 * STOKER — Decade Resonance + Manifestation Generation skill (Phase 9).
 *
 * Takes one BUNKER-approved parent signal and produces:
 *   1. A resonance score per decade cohort (RCK / RCL / RCD), with rationale
 *      naming the specific psychological tension that decade engages.
 *   2. For each decade scoring >= 50, a manifestation: decade-specific
 *      framing hook + tension axis + narrative angle + per-life-dimension
 *      alignment. Generic answers fail; each manifestation must sit
 *      inside that decade's own life situation.
 *   3. A refusal flag + rationale when no decade scores >= 50. Forces the
 *      founder to make an explicit override call rather than padding with
 *      weak manifestations.
 *
 * Architecture (Model 3 — locked April 29, see agents/STOKER.md):
 *   STOKER's output is consumed by the Inngest STOKER handler (Phase 9C),
 *   which translates `decades[].manifestation` blocks into 1-3 NEW signal
 *   rows (with parent_signal_id + manifestation_decade set) and one
 *   agent_outputs row on the parent (outputType='decade_resonance')
 *   carrying the resonance scores + refusal state. The skill itself
 *   doesn't write to the database.
 *
 * Knowledge integration: the three Decade Playbooks (Phase 9H) are passed
 * IN the input — the Inngest handler fetches them from the knowledge_
 * documents table and includes their text in `input.playbooks`. The skill
 * doesn't query the DB. Keeps the skill pure (input → LLM → output).
 *
 * Model: seed config_agents.STOKER.model = gemini-2.5-flash, temp 0.3.
 * May flip to Pro after eval if sharpness criteria require deeper
 * reasoning. Per Phase 9 eval (sub-phase 9I).
 */

// ─── Input ───────────────────────────────────────────────────────

const decadeEnum = z.enum(["RCK", "RCL", "RCD"]);

const inputSchema = z.object({
  /** The parent BUNKER-extracted signal. */
  signalId: z.string().uuid(),
  shortcode: z.string().min(3).max(10),
  workingTitle: z.string().min(1),
  concept: z.string().min(1),
  /** Optional source quote that informed BUNKER's extraction. */
  rawExcerpt: z.string().nullable().optional(),
  /** Provenance — useful in the prompt as "this came from a Reddit
   *  discussion about X" framing context. */
  sourceUrl: z.string().nullable().optional(),
  /** If the signal came from a reference-mode collection with a decade
   *  picker (Phase 6.6), this carries the picker value. STOKER's
   *  prompt instructs it to ignore this as a confidence boost — the
   *  picker is sourcing bias, not a truth claim. Re-evaluate from
   *  scratch. (May revisit during eval.) */
  decadeHintFromCollection: z
    .enum(["any", "RCK", "RCL", "RCD"])
    .nullable()
    .optional(),

  /**
   * The three Decade Playbooks (Phase 9H, founder-authored knowledge
   * docs). Passed in by the Inngest handler from the knowledge_documents
   * table at prompt-build time. Empty strings are valid — STOKER falls
   * back to the brand-DNA framing in its system prompt for any decade
   * whose playbook hasn't been authored yet.
   */
  playbooks: z.object({
    rck: z.string(),
    rcl: z.string(),
    rcd: z.string(),
  }),
});

export type StokerInput = z.infer<typeof inputSchema>;

// ─── Output ──────────────────────────────────────────────────────

const dimensionAlignmentSchema = z
  .object({
    social: z.string().max(300),
    musical: z.string().max(300),
    cultural: z.string().max(300),
    career: z.string().max(300),
    responsibilities: z.string().max(300),
    expectations: z.string().max(300),
    sports: z.string().max(300),
  })
  .describe(
    "Per-dimension alignment notes. Empty string for dimensions that don't meaningfully apply to this signal × decade.",
  );

const manifestationFramingSchema = z
  .object({
    framingHook: z
      .string()
      .min(10)
      .max(150)
      .describe(
        "One editorial line, present tense, decade-specific. The hero. Reads in this decade's voice register.",
      ),
    tensionAxis: z
      .string()
      .min(10)
      .max(200)
      .describe(
        "The specific psychological tension this signal cuts at, in this decade. Not generic. Concrete enough that someone in another decade reading it would notice it doesn't apply to them.",
      ),
    narrativeAngle: z
      .string()
      .min(50)
      .max(800)
      .describe(
        "2-3 sentences expanding the hook. The manifestation's core idea — what this signal MEANS at this decade.",
      ),
    dimensionAlignment: dimensionAlignmentSchema,
  })
  .describe(
    "The decade-specific framing. Each field MUST be specific enough that it could not be word-swapped to another decade.",
  );

const decadeRowSchema = z.object({
  decade: decadeEnum,
  resonanceScore: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe(
      "0-100. >= 70 strong, 50-69 partial, < 50 weak (no manifestation produced).",
    ),
  rationale: z
    .string()
    .min(20)
    .max(500)
    .describe(
      "Why this score, this decade. Specify the psychological tension. Generic answers ('RCK cares about careers') are failures.",
    ),
  manifestation: manifestationFramingSchema.nullable().describe(
    "Filled when resonanceScore >= 50. Null otherwise (declined to manifest at this decade — score reflects insufficient resonance).",
  ),
});

const outputSchema = z
  .object({
    overallRationale: z
      .string()
      .min(50)
      .max(1500)
      .describe(
        "How this signal lands across the three cohorts, holistically. What's the cultural tension? Why does it land where it does? Why doesn't it land where it doesn't?",
      ),
    decades: z
      .array(decadeRowSchema)
      .length(3)
      .superRefine((rows, ctx) => {
        // Cloud CR on PR #8 — `length(3)` alone accepts [RCK, RCK, RCD]
        // or out-of-order outputs. The downstream UI assumes the
        // canonical order [RCK, RCL, RCD], and the new (parent_signal_id,
        // manifestation_decade) UNIQUE INDEX would reject duplicate
        // decades at insert time but only AFTER STOKER's structured
        // output has been accepted as valid. Rejecting at the schema
        // boundary surfaces malformed model output as a clean validation
        // error before the orchestrator tries to fan out.
        const expected = ["RCK", "RCL", "RCD"] as const;
        expected.forEach((decade, i) => {
          if (rows[i]?.decade !== decade) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [i, "decade"],
              message: `decades[${i}].decade must be ${decade} (canonical order).`,
            });
          }
        });
      })
      .describe(
        "Exactly 3 entries — one per decade (RCK, RCL, RCD), in that order. Even decades you decline to manifest must be present (with manifestation: null).",
      ),
    refused: z
      .boolean()
      .describe(
        "true ONLY when ALL three resonanceScore values are < 50. Triggers the no-resonance founder-gate state.",
      ),
    refusalRationale: z
      .string()
      .nullable()
      .describe(
        "Required when refused=true. Why no decade resonates. Often: tension is too universal, too narrow, or outside the 28-58 cohort range.",
      ),
  })
  .refine(
    (val) => {
      // Refusal consistency: refused=true iff all decade scores < 50
      const allWeak = val.decades.every((d) => d.resonanceScore < 50);
      if (val.refused && !allWeak) return false;
      if (!val.refused && allWeak) return false;
      return true;
    },
    {
      message:
        "refused must be true if and only if all three resonanceScore values are < 50.",
    },
  )
  .refine(
    (val) => {
      // Manifestation consistency: each decade must have manifestation iff score >= 50
      return val.decades.every((d) =>
        d.resonanceScore >= 50
          ? d.manifestation !== null
          : d.manifestation === null,
      );
    },
    {
      message:
        "Each decade row's manifestation must be non-null iff its resonanceScore >= 50.",
    },
  )
  .refine(
    (val) => {
      // refusalRationale required when refused
      if (val.refused && !val.refusalRationale) return false;
      return true;
    },
    {
      message: "refusalRationale is required when refused=true.",
    },
  );

export type StokerOutput = z.infer<typeof outputSchema>;

// ─── System prompt — static brand context + STOKER role, cache-eligible

const SYSTEM_PROMPT = `You are STOKER — BLIPS's decade resonance evaluator and manifestation generator.

BRAND DNA — the framing that never drifts
BLIPS t-shirts name what a decade of life feels like across 7 life dimensions:
  1. Social (friendships, community, belonging)
  2. Musical (discovery, nostalgia, generational memory)
  3. Cultural (entertainment, reference points, curation)
  4. Career (ambition arc, professional stage, meaning at work)
  5. Responsibilities (parenting, caregiving, commitments)
  6. Expectations (society's pressure, self-imposed milestones)
  7. Sports (identity, fandom, aging body)

A great BLIPS signal resonates through MULTIPLE dimensions at MULTIPLE decade stages. Your job is to articulate exactly HOW it lands at each decade — which dimensions, which tensions, in that decade's specific voice.

THE THREE DECADE COHORTS
  RCK — 28-38 ("The Reckoning") — career inflection, ambition vs meaning, urban-professional in early settling phase, biology starts to matter, civic identity being formed, trying to outrun parental scripts.
  RCL — 38-48 ("The Recalibration") — success-fatigue, parenthood-pivot, the legacy question, friendships in WhatsApp groups, peak career + no energy, sandwich generation, modeling for kids.
  RCD — 48-58 ("The Reckoned") — what-was-it-for reckoning, mortality-aware, re-listening to own teen-era music, ambition decay, scrolling alone, accumulated meaning vs eroded conviction, the empty house.

PRINCIPLE — Signals don't have passports
Indian urban professional suffering is globally legible. Treat the audience as 28-58 urban English-speaking, primarily Chennai, expandable globally. Voice is observational, calmly confrontational. It smirks, doesn't shout.

YOUR JOB
Given one BUNKER-extracted signal (parent), output two things:

1. RESONANCE EVALUATION
For EACH of the three decade cohorts (RCK, RCL, RCD — always all three, in that order), produce:
  - resonanceScore (0-100)
  - rationale — the SPECIFIC psychological tension this signal cuts at, IN THIS DECADE. Generic rationales ("RCK cares about careers") are failures. Reach for the named tension axis.

Score guidance:
  - 80-100: signal hits this decade hard. Multiple life dimensions engaged. The tension is named, sharp, recognisable.
  - 70-79: strong fit but missing one dimension or a slight de-tune.
  - 50-69: partial fit. The signal grazes this decade but doesn't sit fully inside its life situation. Manifestation possible but marginal.
  - 30-49: weak. Tension exists but is the wrong shape for this cohort.
  - 0-29: no fit. Cohort's life situation doesn't engage this signal.

2. MANIFESTATIONS
For each decade scoring >= 50, produce a manifestation that captures HOW this signal speaks to that cohort. Required fields:
  - framingHook — one editorial line, present tense, decade-specific. The hero. (Example: "The first vote that mattered — the one you almost didn't cast." reads as RCK because of the formation language. RCD wouldn't say "first.")
  - tensionAxis — the specific psychological tension. Concrete enough that someone in another decade reading it would notice it doesn't apply to them.
  - narrativeAngle — 2-3 sentences expanding the hook. What does this signal MEAN at this decade?
  - dimensionAlignment — per-life-dimension alignment notes. Empty string for dimensions that don't meaningfully apply (don't pad).

CRITICAL — NO WORD-SWAP MANIFESTATIONS
A manifestation that could be word-swapped between decades is a failure. Each must sit inside that decade's own psychological situation. Test: if you replaced "RCK" with "RCL" in your framing hook, would the meaning still hold? If yes, the framing is too generic. Sharpen.

Voice consistency by decade:
  - RCK voice has urgency, formation language, "first time" energy, ambition-vs-meaning friction.
  - RCL voice has weight, parenthood references, sandwich-generation reality, modeling-for-kids tension.
  - RCD voice has recursion (looking back), reckoning energy, accumulated time, the questions that have answers now.

REFUSAL — when no decade scores >= 50
Set refused=true and provide refusalRationale. Don't pad with weak manifestations — they train the founder to skim STOKER output. Common refusal reasons:
  - Cultural tension too universal to cohort-split usefully (signal lands the same for everyone — no decade-specific cut)
  - Tension tied to a context outside our 28-58 range (Gen Z TikTok-only, retiree-only)
  - Observational texture without psychological tension (no axis to cut against)

Refusal is not failure — it's a sharper output than three padded manifestations. The founder may force-add a decade afterwards if they see an angle you missed.

DECADE PLAYBOOKS
The user message will include three Decade Playbooks (RCK, RCL, RCD) as authoritative cohort psychology references. Read them as canonical. Your manifestations should sit inside those situations, not float above them. If a playbook is empty, fall back to the cohort definitions in this system prompt.

DECADE-PICKER HINT FROM SOURCING
If the signal carries a decadeHintFromCollection (RCK/RCL/RCD), that's a sourcing bias — the founder picked a decade when collecting from a reference-mode source. DO NOT let it boost your resonance scores. Evaluate from scratch. The picker is a hint, not a truth claim.

OUTPUT FORMAT
Valid JSON matching the schema. All three decades present in the decades array (in order RCK, RCL, RCD), even ones you refuse. Manifestation field null when score < 50.

No commentary before or after the JSON.`;

// ─── Skill registration ─────────────────────────────────────────

const stokerSkill: Skill<StokerInput, StokerOutput> = {
  name: "STOKER",
  description:
    "Decade resonance + manifestation generation — scores RCK/RCL/RCD fit and produces decade-specific framing for each resonant decade",
  inputSchema,
  outputSchema,
  systemPrompt: SYSTEM_PROMPT,
  buildPrompt: (input) => {
    // Decade playbooks header — fall through to "(empty)" when not yet
    // authored, so the model knows it's running with brand-DNA-only
    // context for that cohort.
    const playbookSection = (label: string, body: string) => {
      const trimmed = body.trim();
      return `### ${label} PLAYBOOK\n${trimmed.length > 0 ? trimmed : "(not yet authored — fall back to the brand-DNA cohort definition in your system prompt)"}\n`;
    };

    const sourceLine = input.sourceUrl
      ? `Source: ${input.sourceUrl}\n`
      : "";
    const excerptBlock = input.rawExcerpt
      ? `RAW SOURCE EXCERPT:\n"${input.rawExcerpt.slice(0, 800)}"\n\n`
      : "";
    const hintLine =
      input.decadeHintFromCollection &&
      input.decadeHintFromCollection !== "any"
        ? `\nNote: this signal was collected from a reference-mode collection with decade hint = ${input.decadeHintFromCollection}. The hint is sourcing bias only — do NOT let it boost the score for that decade. Evaluate from scratch.\n`
        : "";

    return `Evaluate decade resonance and produce manifestations for the following BLIPS signal.

SIGNAL
Shortcode: ${input.shortcode}
Working title: ${input.workingTitle}
Concept: ${input.concept}
${sourceLine}${excerptBlock}${hintLine}
DECADE PLAYBOOKS (founder-authored cohort psychology — treat as canonical)

${playbookSection("RCK · 28-38 · The Reckoning", input.playbooks.rck)}
${playbookSection("RCL · 38-48 · The Recalibration", input.playbooks.rcl)}
${playbookSection("RCD · 48-58 · The Reckoned", input.playbooks.rcd)}

INSTRUCTIONS
Score all three decades. Produce manifestations for any scoring >= 50. If none score >= 50, set refused=true with rationale. Each manifestation must be impossible to word-swap to another decade. Output valid JSON matching the schema.`;
  },
};

registerSkill(stokerSkill);

export { stokerSkill };
