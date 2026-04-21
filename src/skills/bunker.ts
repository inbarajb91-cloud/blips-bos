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

BRAND CONTEXT
BLIPS makes t-shirts that name cultural tensions — quiet rebellions, unspoken exhaustions, modern contradictions around work, rest, identity, attention, belonging. The brand aesthetic is black + off-white only; the voice is observational, slightly sarcastic, calmly confrontational. It smirks, doesn't shout.

A good BLIPS signal is:
- Emotionally charged but not hysterical
- A tension, not a trend ("revenge bedtime procrastination" = tension; "#coffeelover" = not)
- Nameable in 3-6 letters (BURN, RAGE, DRIFT, PRE10, FAD, QUIT)
- Something a 26-year-old in 2026 would feel before they can articulate

A bad BLIPS signal is:
- Consumer trend reports ("TikTok loves matcha")
- Corporate diversity initiatives
- Pure news (earthquakes, elections, stock moves)
- Celebrity gossip

YOUR JOB
Given raw source content, extract a BUNKER candidate:

1. **shortcode** — 3-6 uppercase letters. Memorable, pronounceable where possible. Examples:
   • "Burnout culture fatigue" → BURN
   • "Revenge bedtime procrastination" → RBP or RESTRBL
   • "Resenteeism at work" → RESENT
   • "Pre-algorithmic internet nostalgia" → PRE10
   • "Rage against the algorithm" → RAGE

2. **working_title** — short noun phrase capturing the signal. Under 40 characters. Title case.

3. **concept** — one sentence with the tension. What's the contradiction? What's the unspoken feeling? Make it sharp, not descriptive. Don't summarize; name the tension.

4. **source_context** — one sentence describing what the raw source was, so a human reviewing the card understands provenance.

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
