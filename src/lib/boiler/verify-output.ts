/**
 * Phase 11D — BOILER output verifier (vision-LLM-as-judge).
 *
 * After every BOILER generation, run the produced image through a
 * vision-capable LLM to confirm it actually clears the BLIPS bar
 * (multi-element composition, legible text, palette adherence) before
 * it reaches the founder.
 *
 * Why: gpt-image-1 reliably mangles text at low tier ("AHEAD ON PAPER"
 * → "AнULПA PAPED"), occasionally ignores palette specs, and sometimes
 * produces single-element compositions. Showing those to the founder
 * breaks the premium-design promise. The verifier catches them and
 * either (a) auto-retries on low tier with the issues fed into the next
 * prompt, or (b) surfaces the issues to ORC for human-in-the-loop
 * refinement on medium/high tier (more expensive — don't burn money
 * silently).
 *
 * Model choice: Gemini 2.5 Flash (multimodal, cheap, 250 req/day free
 * tier, ~$0.0001 per call when paid). The verifier runs on every
 * BOILER call, so it has to be cheap enough not to dominate the bill.
 *
 * Verification persists into `design_versions.composition_meta.verification`
 * so the renderer can surface the pass/fail state + issues in the UI.
 *
 * Run live: bundled into the verify-boiler-v2-openai.ts script;
 * standalone via importing and calling verifyDesignOutput().
 */

import { z } from "zod";
import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import type { PaletteRoles } from "./types";

/**
 * Structured verifier output. The LLM produces this JSON; we compute
 * `passed` in code (LLMs are inconsistent at boolean judgments — sub-scores
 * are more reliable, then we threshold).
 */
const verifierResponseSchema = z.object({
  text_legibility: z.object({
    score: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe(
        "0 if no text is readable, 100 if all expected text is rendered cleanly and exactly. Be strict — garbled letters (e.g. 'AнULПA PAPED' instead of 'AHEAD ON PAPER') score below 30.",
      ),
    detected_strings: z
      .array(z.string())
      .describe(
        "Every text string you can identify in the image, in the order they appear. Include garbled versions verbatim (don't 'autocorrect' to what you think they meant). Empty array if no text is visible.",
      ),
    expected_strings_found: z
      .array(z.string())
      .describe(
        "Subset of the expected strings (from the prompt) that are rendered LEGIBLY and EXACTLY in the image.",
      ),
    issues: z
      .string()
      .describe(
        "What's wrong with the text rendering, if anything. One sentence. Empty string if perfect.",
      ),
  }),
  palette_adherence: z.object({
    score: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe(
        "0 if dominant colors are entirely different from the expected palette, 100 if they match closely.",
      ),
    dominant_hex_codes: z
      .array(z.string())
      .describe(
        "3-5 dominant colors you observe in the image, as 6-digit hex codes with leading #.",
      ),
    issues: z
      .string()
      .describe(
        "How the actual palette deviates from expected, if at all. One sentence.",
      ),
  }),
  composition: z.object({
    score: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe(
        "0 for single-element designs (e.g. a wordmark alone, a centered logo), 100 for rich multi-element compositions with 4+ distinct visual elements working as one idea.",
      ),
    element_count: z
      .number()
      .int()
      .describe(
        "How many distinct visual elements you can identify (rings, geometric shapes, text columns, lines, dots, etc.)",
      ),
    elements_observed: z
      .array(z.string())
      .describe("List of the elements you observed."),
    issues: z
      .string()
      .describe("What's wrong with composition, if anything. One sentence."),
  }),
  conceptual_fit: z.object({
    score: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe(
        "How well the image realises the design brief's conceptual idea (not visual style — the IDEA). 0 = unrelated, 100 = clear realisation.",
      ),
    summary: z
      .string()
      .describe(
        "One-sentence summary of what the design actually communicates.",
      ),
    issues: z.string().describe("How the design deviates from the brief."),
  }),
  refinement_suggestions: z
    .array(z.string())
    .max(5)
    .describe(
      "1-5 specific, actionable instructions a designer could follow to improve this design. E.g. 'tighten the front text letter-spacing', 'shift the ring origin to the upper-right'. Skip vague suggestions like 'make it look better'.",
    ),
});

export type VerifierResponse = z.infer<typeof verifierResponseSchema>;

/**
 * Full verification record — what gets persisted on design_versions.composition_meta.verification.
 * Combines the raw LLM judgment with our computed pass/fail + metadata.
 */
export interface VerificationResult extends VerifierResponse {
  /** Computed in code: passes all thresholds. */
  passed: boolean;
  /** Overall score: weighted average of sub-scores. */
  overall_score: number;
  /** Model id that produced the verdict. */
  verifier_model: string;
  /** ISO timestamp of when verification ran. */
  verified_at: string;
  /** Wall-clock ms of the verifier call. */
  duration_ms: number;
}

export interface VerifyOptions {
  /** URL of the design to verify (Cloudinary delivery URL or any HTTPS-reachable URL). */
  imageUrl: string;
  /** Exact text strings expected on this face (front or back). */
  expectedTexts: string[];
  /** Palette roles from the design brief. */
  paletteRoles: PaletteRoles;
  /** Brief summary of the conceptual idea — what should this design communicate? */
  conceptualBrief: string;
  /** Which face this design represents — for context to the verifier. */
  face?: "front" | "back";
  /** Override the verifier model. Default: gemini-2.5-flash. */
  model?: string;
  /** Per-call timeout. Default: 30s. */
  timeoutMs?: number;
}

/** Pass thresholds — design must clear all four to pass. */
const PASS_THRESHOLDS = {
  text_legibility: 60,
  palette_adherence: 50,
  composition: 65,
  conceptual_fit: 60,
} as const;

/** Weights for computing overall_score from sub-scores. */
const SCORE_WEIGHTS = {
  text_legibility: 0.30,
  palette_adherence: 0.25,
  composition: 0.25,
  conceptual_fit: 0.20,
} as const;

/** Build the verifier prompt — the question we ask the vision LLM. */
function buildVerifierPrompt(opts: VerifyOptions): string {
  const face = opts.face ?? "front";
  const palette = Object.entries(opts.paletteRoles)
    .map(([role, hex]) => `${role}: ${hex}`)
    .join(", ");

  return [
    `You are a quality verifier for BLIPS apparel designs. BLIPS is a premium philosophical t-shirt brand — every design must be rich, multi-element, and execute its conceptual idea with craft.`,
    ``,
    `Below is a BOILER-generated design (${face} face). Evaluate it against the brief and return structured JSON.`,
    ``,
    `## EXPECTED TEXT`,
    opts.expectedTexts.length > 0
      ? opts.expectedTexts.map((t, i) => `${i + 1}. "${t}"`).join("\n")
      : "(no text expected on this face)",
    ``,
    `## EXPECTED PALETTE`,
    palette,
    ``,
    `## CONCEPTUAL BRIEF`,
    opts.conceptualBrief,
    ``,
    `## EVALUATION CRITERIA`,
    `1. **Text legibility** — Does the image contain the expected text strings, rendered LEGIBLY and EXACTLY? Garbled, partial, or missing text fails this check. Do not "autocorrect" what you read.`,
    `2. **Palette adherence** — Do the dominant colors in the image match the expected hex codes (within reasonable visual similarity)?`,
    `3. **Composition** — Is this a multi-element design (4+ distinct visual elements working as one composition) or a single-element design (wordmark alone, centered logo)? Premium BLIPS designs are always multi-element.`,
    `4. **Conceptual fit** — Does the design actually realise the brief's idea, or is it decorative noise?`,
    ``,
    `## CRITICAL`,
    `Be HONEST. The brand exists to ship craft-grade apparel; a too-lenient verifier ships placeholder-quality designs and erodes the brand. If text is garbled, score it low — even if the rings and shapes are right. If colors are wrong, say so — even if the composition is interesting.`,
    `Output ONLY the structured JSON. No commentary.`,
  ].join("\n");
}

/** Pure compute: derive `passed` and `overall_score` from the LLM's sub-scores. */
function computePassAndScore(r: VerifierResponse): {
  passed: boolean;
  overall_score: number;
} {
  const overall_score = Math.round(
    r.text_legibility.score * SCORE_WEIGHTS.text_legibility +
      r.palette_adherence.score * SCORE_WEIGHTS.palette_adherence +
      r.composition.score * SCORE_WEIGHTS.composition +
      r.conceptual_fit.score * SCORE_WEIGHTS.conceptual_fit,
  );
  const passed =
    r.text_legibility.score >= PASS_THRESHOLDS.text_legibility &&
    r.palette_adherence.score >= PASS_THRESHOLDS.palette_adherence &&
    r.composition.score >= PASS_THRESHOLDS.composition &&
    r.conceptual_fit.score >= PASS_THRESHOLDS.conceptual_fit;
  return { passed, overall_score };
}

/**
 * Verify a BOILER design output against its brief.
 *
 * Fetches the image (Gemini accepts URLs directly), sends it to the multimodal
 * model along with the expected text/palette/brief, and parses the structured
 * verdict. Throws on LLM error (caller wraps in fallback or retry).
 */
export async function verifyDesignOutput(
  opts: VerifyOptions,
): Promise<VerificationResult> {
  const modelId = opts.model ?? "gemini-2.5-flash";
  const start = Date.now();

  const result = await generateObject({
    model: google(modelId),
    schema: verifierResponseSchema,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: buildVerifierPrompt(opts) },
          { type: "image", image: new URL(opts.imageUrl) },
        ],
      },
    ],
    temperature: 0.2, // verification should be consistent, not creative
    abortSignal: opts.timeoutMs
      ? AbortSignal.timeout(opts.timeoutMs)
      : AbortSignal.timeout(30_000),
  });

  const duration_ms = Date.now() - start;
  const { passed, overall_score } = computePassAndScore(result.object);

  return {
    ...result.object,
    passed,
    overall_score,
    verifier_model: modelId,
    verified_at: new Date().toISOString(),
    duration_ms,
  };
}
