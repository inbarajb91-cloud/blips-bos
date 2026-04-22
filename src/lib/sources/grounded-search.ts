import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import type { RawCandidate } from "./types";

/**
 * Phase 6.6 — Gemini grounded-search connector.
 *
 * When a collection is in `search_mode="reference"`, BUNKER's sourcing
 * strategy switches from "pull from standing 5 sources + filter" to "use
 * the outline as a real web query via Gemini useSearchGrounding."
 *
 * Flow:
 *   1. Read collection's outline (the theme) + optional decade_hint
 *   2. Call Gemini 2.5 Flash with `useSearchGrounding: true` — this makes
 *      the model pull live web content matching the outline
 *   3. Instruct the model to produce a JSON array of candidate tensions
 *      (same shape as other sources — title + body)
 *   4. Return as RawCandidate[] with source='grounded_search'
 *   5. BUNKER's standard extraction runs on each, same as any other source
 *
 * Cost: one grounded-search call costs ~$0.03 on Gemini Flash (vs ~$0.001
 * for a normal Flash call) because of the web-search fee. Downstream BUNKER
 * extraction is standard pricing. An Instant (5 signals) run in reference
 * mode runs ~$0.035 total. A Batch of 50 runs ~$0.08.
 */

const GROUNDED_SYSTEM_PROMPT = `You are BUNKER's reference-search source for BLIPS, a premium philosophical apparel brand.

AUDIENCE: urban English-speaking 28-58 across three cohorts — 28-38 building career, 38-48 mid-career sandwich generation, 48-58 late career empty-nester. Primary market Chennai India; Indian urban professionals read Western content as native — source lineup is globally blended.

BLIPS DESIGNS name what a decade of life feels like across 7 life dimensions: social, musical, cultural, career, responsibilities, expectations, sports. A great signal is:
- Emotionally charged (a named unspoken thing, not a report)
- Multi-dimensional (touching multiple of the 7)
- A contradiction or paradox (not a trend, not news)
- Nameable in a short memorable phrase
- Resonant for the 28-58 cohort specifically

YOUR JOB
The user provides a theme or search query. Use web search to find real current content on that theme — recent articles, posts, essays, discussions from the last few months. Then synthesize 3-6 candidate tensions from that research.

Return raw content — each candidate should be a title + a body paragraph that a human reader could recognize as a lived tension, NOT a paraphrased news summary.

EXAMPLES of good output (target feel, not copy):
{
  "title": "The Late-Night Spreadsheet",
  "body": "At 1am you keep opening a financial planning spreadsheet you already know the answer to. Your EMIs, the kid's future school fees, your parents' medical inflation — numbers that don't add up no matter which cell you edit. The compulsion isn't planning; it's the only thing that gives the anxiety a shape you can argue with."
}

AVOID: direct quotes or summaries of news articles, generic trend reports, consumer buzz framing, Western-corporate framings that don't translate.

OUTPUT FORMAT: Return a strict JSON array of candidates. No commentary outside the JSON. No markdown fences. Just the array.

[
  { "title": "...", "body": "..." },
  { "title": "...", "body": "..." }
]`;

const candidateSchema = z.object({
  title: z.string().min(3).max(120),
  body: z.string().min(80).max(1200),
});

const candidatesArraySchema = z.array(candidateSchema).min(1).max(10);

interface GroundedSearchParams {
  outline: string;
  decadeHint?: "any" | "RCK" | "RCL" | "RCD";
  /** How many candidates to request. Default 6 — BUNKER extraction + dedup
   * will trim further. */
  targetCount?: number;
  // NOTE: orgId was declared here but never used. Removed to keep the
  // interface honest. Per-org observability for grounded-search calls
  // (billable Gemini tier — ~$0.03-0.05 per run) belongs in the
  // agent_logs pattern used by other skills, wired up alongside the
  // broader Phase 7+ observability pass.
}

function decadeInstruction(hint: GroundedSearchParams["decadeHint"]): string {
  switch (hint) {
    case "RCK":
      return "PRIMARY AUDIENCE SLICE: 28-38 (early career, young parents, building ambition). Lean sourcing + framing toward this decade.";
    case "RCL":
      return "PRIMARY AUDIENCE SLICE: 38-48 (mid-career sandwich generation, kids + parents). Lean sourcing + framing toward this decade.";
    case "RCD":
      return "PRIMARY AUDIENCE SLICE: 48-58 (late career, empty nester, legacy questions). Lean sourcing + framing toward this decade.";
    default:
      return "AUDIENCE: span all three decade cohorts. Find tensions that resonate at more than one life stage.";
  }
}

export async function fetchGroundedSearchCandidates({
  outline,
  decadeHint = "any",
  targetCount = 6,
}: GroundedSearchParams): Promise<RawCandidate[]> {
  const trimmedOutline = outline.trim();
  if (trimmedOutline.length < 10) {
    throw new Error(
      "Reference mode requires a meaningful outline (≥10 chars) as the search query.",
    );
  }

  const userPrompt = `SEARCH QUERY: "${trimmedOutline}"

${decadeInstruction(decadeHint)}

Use grounded web search to find current content about this theme. Then synthesize ${targetCount} candidate tensions — each a title + body paragraph that names an emotionally-charged contradiction around this theme. Return as a JSON array per the schema.`;

  let text: string;
  let groundingMetadata: unknown;
  try {
    // @ai-sdk/google v3.0+ exposes grounded search via the `tools` API
    // (googleSearch) rather than a `useSearchGrounding` boolean option.
    // Tool name MUST be `google_search` per provider contract.
    const result = await generateText({
      model: google("gemini-2.5-flash"),
      tools: {
        google_search: google.tools.googleSearch({}),
      },
      system: GROUNDED_SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0.4,
    });
    text = result.text;
    groundingMetadata =
      (result.providerMetadata as Record<string, unknown> | undefined)?.google ??
      null;
  } catch (e) {
    console.error(
      "[grounded-search] Gemini grounded-search call failed:",
      (e as Error).message,
    );
    throw e;
  }

  // Gemini occasionally wraps the JSON in ```json ... ``` fences or adds
  // a leading sentence despite the no-commentary instruction. Strip defensively.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  // Find the first `[` — anything before is a stray sentence.
  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  const jsonSlice =
    firstBracket >= 0 && lastBracket > firstBracket
      ? cleaned.slice(firstBracket, lastBracket + 1)
      : cleaned;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch (e) {
    console.error(
      "[grounded-search] Failed to parse JSON from Gemini response:",
      (e as Error).message,
      "\nFirst 500 chars of response:",
      cleaned.slice(0, 500),
    );
    return [];
  }

  const validation = candidatesArraySchema.safeParse(parsed);
  if (!validation.success) {
    console.error(
      "[grounded-search] Response didn't match schema:",
      validation.error.message,
    );
    return [];
  }

  return validation.data.map(
    (c): RawCandidate => ({
      source: "grounded_search",
      title: c.title,
      body: c.body,
      metadata: {
        outline: trimmedOutline,
        decade_hint: decadeHint,
        synthesized_by: "gemini-2.5-flash (grounded)",
        grounding: groundingMetadata,
      },
    }),
  );
}
