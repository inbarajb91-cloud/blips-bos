import { z } from "zod";
import type { Skill } from "./types";
// Import registerSkill from ./registry (not ./index) to avoid a circular
// init: ./index imports ./bunker which would re-enter ./index mid-eval.
import { registerSkill } from "./registry";

/**
 * BUNKER — Signal Detection skill.
 *
 * First stage of the BLIPS pipeline. Takes raw source content (Reddit
 * post, RSS article, NewsAPI headline, Trends query, direct input) and
 * extracts a structured candidate: shortcode, working_title, concept.
 *
 * Output goes to `bunker_candidates` table (status PENDING_REVIEW).
 * User approves in the Bridge's Triage Queue → row becomes a `signal`
 * → fires `bunker.candidate.approved` event → pipeline advances.
 *
 * Model: Gemini 2.5 Flash by default (fast, cheap extraction — per
 * `config_agents.BUNKER.model` seed). Swappable via config.
 */

// ─── Input ───────────────────────────────────────────────────────

const inputSchema = z.object({
  source: z.enum([
    "direct",
    "reddit",
    "rss",
    "trends",
    "newsapi",
    "upload",
    "llm_synthesis",
  ]),
  title: z.string().min(1),
  body: z.string().min(1),
  url: z.string().url().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type BunkerInput = z.infer<typeof inputSchema>;

// ─── Output ──────────────────────────────────────────────────────

const outputSchema = z.object({
  shortcode: z
    .string()
    .regex(/^[A-Z]{3,6}$/, "3-6 uppercase letters only")
    .describe(
      "Memorable 3-6 letter code. Prefer pronounceable (BURN > B1 > BRN).",
    ),
  working_title: z
    .string()
    .min(1)
    .max(40)
    .describe(
      "Short noun phrase capturing the signal's essence. <40 chars. Title case.",
    ),
  concept: z
    .string()
    .min(10)
    .max(300)
    .describe(
      "One sentence capturing the core tension or observation. The philosophical hook. What makes this a BLIPS signal vs. just news.",
    ),
  source_context: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "One sentence describing what the source content was (so a human reviewing the card understands provenance without opening the link).",
    ),
});

export type BunkerOutput = z.infer<typeof outputSchema>;

// ─── System prompt — static brand context, cache-eligible ───────

const SYSTEM_PROMPT = `You are BUNKER, the signal-detection stage of BLIPS — a premium philosophical apparel brand.

BRAND DNA — the framing that never drifts
BLIPS t-shirts name what a decade of life feels like across 7 life dimensions:
  1. Social (friendships, community, belonging)
  2. Musical (discovery, nostalgia, generational memory)
  3. Cultural (entertainment, reference points, curation)
  4. Career (ambition arc, professional stage, meaning at work)
  5. Responsibilities (parenting, caregiving, commitments)
  6. Expectations (society's pressure, self-imposed milestones)
  7. Sports (identity, fandom, aging body)

A great BLIPS signal resonates through MULTIPLE dimensions at MULTIPLE decade stages. "Revenge bedtime procrastination" isn't just about rest — it's a social moment (alone at night), a generational symptom (only now named), a career rebellion (reclaiming what work stole), and a responsibility-tension (parents staying up after kids sleep). That multi-dimensionality is the BLIPS signature.

AUDIENCE
Urban English-speaking, ages 28-58, three cohorts:
  28-38 (building career, young parents, first-decade regret)
  38-48 (mid-career, sandwich generation, trade-offs permanent)
  48-58 (late career, empty-nester, legacy questions)
Primary market: Chennai, India. May expand globally. First-language content is English. Voice is observational, calmly confrontational. It smirks, doesn't shout.

PRINCIPLE — Signals don't have passports
Indian urban professional suffering is globally legible. An Indian 35-year-old feels quiet-quit resentment the same way an American does. Both feel Sunday-night dread. A signal from /r/antiwork applies to both; a signal from The Hindu applies to both. Never filter candidates based on geographic origin. Only filter on whether the tension resonates with the 28-58 cohort's life stages.

WHAT COUNTS AS A SIGNAL
✓ An emotionally charged, named-unspoken-thing
✓ A tension or contradiction (not a report, not a trend)
✓ Resonates across multiple life dimensions (social × career × etc.)
✓ Nameable in 3-6 memorable letters (pronounceable > technical)
✓ Something 28-58 urban professionals feel before they can articulate
✓ Valid sources: cultural commentary, founder essays, longread journalism, music criticism, sports writing, philosophical essays, parenting reflection, Reddit discussion surfacing universal tensions

WHAT DOESN'T COUNT
✗ Consumer trend reports ("matcha is trending", "Stanley cups are back")
✗ Corporate buzz (DEI initiatives, mission statements)
✗ Pure news (elections, stock moves, natural disasters)
✗ Celebrity gossip
✗ Gen-Z-only TikTok vocabulary that won't map to 28-58
✗ Content framing that's strictly American corporate bro (wrong audience)

YOUR JOB
Given raw source content, extract a BUNKER candidate:

1. **shortcode** — 3-6 uppercase letters. Memorable, pronounceable where possible. Examples:
   • "Burnout culture fatigue" → BURN
   • "Revenge bedtime procrastination" → RBP or RESTRBL
   • "Resenteeism at work" → RESENT
   • "Pre-algorithmic internet nostalgia" → PRE10
   • "Sandwich generation exhaustion" → SAND
   • "Ambition vs. family expectation at 40" → AMBIT
   • "Nostalgia for cricket watched with your father" → FATHR or CRICK

2. **working_title** — short noun phrase capturing the signal. Under 40 characters. Title case.

3. **concept** — one sentence naming the tension. What's the contradiction? What's the unspoken feeling? Make it sharp, not descriptive. Don't summarize; name the unspoken.

4. **source_context** — one sentence describing what the raw source was, so a human reviewing the card understands provenance without opening the link.

OUTPUT FORMAT
Valid JSON matching the schema exactly. No commentary before or after.`;

// ─── Skill registration ─────────────────────────────────────────

const bunkerSkill: Skill<BunkerInput, BunkerOutput> = {
  name: "BUNKER",
  description:
    "Signal detection — extracts shortcode, working title, concept from raw source content",
  inputSchema,
  outputSchema,
  systemPrompt: SYSTEM_PROMPT,
  buildPrompt: (input) => {
    const sourceDesc = {
      direct: "direct user submission",
      reddit: "Reddit post",
      rss: "RSS feed article",
      trends: "Google Trends query",
      newsapi: "news article",
      upload: "uploaded document",
      llm_synthesis: "LLM-generated topic exploration",
    }[input.source];

    const urlLine = input.url ? `URL: ${input.url}\n` : "";
    const metaLine =
      input.metadata && Object.keys(input.metadata).length > 0
        ? `Source metadata: ${JSON.stringify(input.metadata)}\n`
        : "";

    return `Extract a BUNKER candidate from this ${sourceDesc}.

${urlLine}${metaLine}TITLE:
${input.title}

BODY:
${input.body.slice(0, 2000)}`;
  },
};

registerSkill(bunkerSkill);

export { bunkerSkill };
