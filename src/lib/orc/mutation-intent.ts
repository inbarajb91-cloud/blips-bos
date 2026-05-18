/**
 * REVIEW.md F4 (May 18, 2026) — LLM-backed mutation-intent classifier
 * for the ORC reply gate.
 *
 * Why: the prior implementation was a giant `\b(approve|dismiss|...)\b/i`
 * regex on the user's current message. False positives ate the gate's
 * value — sentences like "I approve of the framing — can you draft a
 * section about that?" matched on `approve`, binding every destructive
 * tool for that turn. The system prompt + per-tool status guards still
 * applied, but the explicit-word gate became near-pass-through.
 *
 * Fix: per Inba's pick (Option A May 18), classify intent via a tiny
 * Gemini Flash call. Returns a strict boolean: does this message
 * actually request a destructive/mutation action?
 *
 * Cost: ~$0.0001/call (≤200 input + ≤10 output tokens on Flash).
 * Latency: live-measured at ~1.5-3s on Flash (avg ~2.1s across 12-case
 * verify script). Higher than I'd initially estimated. If this hurts in
 * practice, candidates for optimization (in priority order):
 *   1. Move to gemini-2.5-flash-lite (smaller model; not yet measured here)
 *   2. Add a fast-path: regex pre-filter for OBVIOUS mutations (single
 *      imperative verb at message start) → skip LLM call for those
 *   3. Run the classifier in parallel with the auth+scope checks, not
 *      serially — currently it adds full latency to the chain
 *
 * Fail-safe direction: on classifier error, return FALSE (don't allow
 * mutation). Safer than the inverse — a temporary classifier outage
 * makes ORC slightly more conservative for one turn; the user retries
 * with cleaner phrasing or ORC asks for explicit confirmation. The
 * inverse failure mode (allow mutation when classifier is down) would
 * actively widen the destructive-tool surface during outage.
 *
 * Defense-in-depth note: even when this returns TRUE, mutation tools
 * still go through (a) the system prompt's framing about explicit user
 * confirmation, (b) action-level org/status checks at the SQL layer, and
 * (c) AI SDK tool-output validation. The classifier only decides whether
 * destructive tools are AVAILABLE to ORC for this turn.
 */

import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";

const CLASSIFIER_MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = 4_000;

const ResultSchema = z.object({
  mutationRequested: z
    .boolean()
    .describe(
      "True if the user's message is requesting a destructive or mutation action " +
        "(approve, dismiss, finalize, advance, regenerate, edit, restart, delete, " +
        "discard, branch, etc). False if the message is questioning, discussing, " +
        "or merely mentioning such actions without requesting them.",
    ),
});

const SYSTEM_PROMPT = `You are a strict binary classifier for the BLIPS BOS pipeline.

Your job: decide whether the user's current message is REQUESTING a destructive
or mutation action on a BLIPS signal/brief/design — vs merely discussing,
questioning, or referencing such an action.

Return TRUE when the user is asking the system to actually DO one of:
  - approve / dismiss / reject / decline / cancel a signal, candidate,
    manifestation, brief section, brief, design variant, gallery
  - advance / ship a signal to the next stage
  - edit / modify / change / rewrite framing, sections, addenda
  - restart / re-run / rerun / regenerate / redo a stage or section
  - force-add a manifestation
  - finalize / approve-and-advance a BOILER design
  - branch a design from an active version
  - discard / delete / remove / trash a version or output
  - pick / commit a concept variant

Return FALSE when the user is:
  - asking what an action means or how it works
  - describing a decision made elsewhere ("the team approved this last week")
  - using the word in a non-action sense ("I approve OF the framing", "the
    approval flow is confusing", "an edit was made")
  - asking ORC to think, explain, draft, summarize, or discuss
  - giving feedback without an action request ("this section reads off")

Hard rule: when in doubt, return FALSE. False positives widen the
destructive-tool surface; false negatives just make ORC ask for explicit
confirmation, which is the safer side to err on.`;

interface ClassifierResult {
  mutationRequested: boolean;
  /** ~ms classifier took. Only set on success — error path returns 0. */
  durationMs: number;
  /** Set when the classifier errored (and we failed safe to false). */
  errorMessage?: string;
}

export async function classifyMutationIntent(
  userMessage: string,
): Promise<ClassifierResult> {
  const started = Date.now();

  // Skip the LLM call on trivially empty messages — saves a roundtrip
  // and the result is structurally false anyway.
  if (!userMessage || userMessage.trim().length === 0) {
    return { mutationRequested: false, durationMs: 0 };
  }

  try {
    const result = await Promise.race([
      generateObject({
        model: google(CLASSIFIER_MODEL),
        schema: ResultSchema,
        system: SYSTEM_PROMPT,
        prompt: `User's current message:\n\n"${userMessage.slice(0, 1500)}"\n\nClassify.`,
        temperature: 0.0,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`mutation-intent classifier timeout after ${TIMEOUT_MS}ms`)),
          TIMEOUT_MS,
        ),
      ),
    ]);
    return {
      mutationRequested: result.object.mutationRequested,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[mutation-intent] classifier failed; failing safe (no mutation allowed): ${msg.slice(0, 100)}`,
    );
    return {
      mutationRequested: false,
      durationMs: Date.now() - started,
      errorMessage: msg,
    };
  }
}
