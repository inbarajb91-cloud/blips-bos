/**
 * Pre-send token estimation — Phase 8.
 *
 * The Vercel AI SDK (the one wrapper we use across every provider)
 * doesn't ship a universal tokenizer, and adding per-provider
 * tokenizers (tiktoken for OpenAI, the Anthropic SDK's internal, a
 * Gemini-equivalent that isn't public) is ~2MB of bundle and a mess
 * of shipping decisions to land just for pre-send budget enforcement.
 *
 * Accurate token counts come from provider responses — they populate
 * `agent_logs.tokens_input` / `tokens_output` after the call. What we
 * need BEFORE the call is a fast, conservative estimate to decide:
 *   1. "Is this prompt within the ~5k per-turn budget?" (if not,
 *      force an extra summarization pass before sending)
 *   2. "Can we fit one more turn of verbatim context before busting?"
 *
 * A calibrated heuristic is the right tool for that job. Character
 * count divided by a per-kind divisor produces estimates within ±15%
 * of truth for English/prose, which is fine for budget decisions.
 * If Phase 8 evals reveal drift, we tighten the constants; we
 * don't swap in a tokenizer library.
 *
 * **Always err high.** A 10% safety margin on the final estimate
 * means we summarize slightly earlier than strictly needed, which is
 * cheaper than breaching budget and triggering a provider error.
 */

/**
 * Per-content-kind character-to-token ratios, calibrated from
 * Anthropic's published guidance (4 chars ≈ 1 token for English)
 * plus BLIPS-specific corpora (ORC prompts are editorial + some
 * structured metadata). All divisors; token count = chars / divisor.
 *
 * These are intentionally slight underestimates (higher divisor =
 * fewer tokens estimated) — the `safety_margin` below re-inflates to
 * produce conservative final estimates.
 */
const CHARS_PER_TOKEN = {
  /** Plain English prose, sentences, markdown text. */
  prose: 4.0,
  /** Structured metadata — JSON, key/value, shortcodes, lists.
   *  Fewer long words, more delimiters; slightly higher density. */
  structured: 3.5,
  /** Code-like content — identifiers, braces, comments. Tight. */
  code: 3.0,
} as const;

type ContentKind = keyof typeof CHARS_PER_TOKEN;

const SAFETY_MARGIN = 1.1;

/**
 * Estimate tokens for a string of known kind. Pass the kind that
 * most closely matches the content; when uncertain, `prose` is the
 * safest default.
 */
export function estimateTokens(text: string, kind: ContentKind = "prose"): number {
  if (text.length === 0) return 0;
  const raw = text.length / CHARS_PER_TOKEN[kind];
  return Math.ceil(raw * SAFETY_MARGIN);
}

/**
 * Estimate total tokens across multiple chunks, each with its own
 * kind. Returns the sum. Useful for layered prompts where different
 * sections have different content densities (system prompt = prose,
 * signal metadata = structured, code excerpts = code).
 */
export function estimatePromptTokens(
  chunks: ReadonlyArray<{ text: string; kind?: ContentKind }>,
): number {
  return chunks.reduce(
    (acc, c) => acc + estimateTokens(c.text, c.kind ?? "prose"),
    0,
  );
}

/**
 * Per-turn budget for ORC conversations — locked in `agents/ORC.md`
 * Phase 8 section. Split into structural allocations so the context
 * builder can enforce each independently:
 *
 *   System prompt + brand DNA + signal core  ≤ 2 500  (cached prefix)
 *   Rolling summary (when present)           ≤   800
 *   Verbatim window (last N turns)           ≤ 2 000
 *   Current user message                     ≤   500
 *                                            ───────
 *   TOTAL INPUT                              ≤ 5 800  (soft cap 5 000)
 *   TOTAL OUTPUT TARGET                       ~1 000
 *
 * Caps are soft — exceeding any single cap triggers summarization or
 * truncation rather than a hard error. The overall per-turn target
 * is ≤ 5k input so even at Claude Sonnet pricing the steady-state
 * cost stays well under $0.02 per reply.
 *
 * 2026-04-25: bumped system_brand_signal 2000 → 2500. Diagnostic
 * showed the static prefix (system prompt + brand DNA) at 1867 tokens
 * leaving only 133 for signal core, while normal signal cores need
 * ~250 tokens. Result: every signal hit a 413 from
 * overBudgetAfterSummarization. Per-bucket caps are soft and don't
 * have to sum to ≤ total_input — only the actual per-turn total does,
 * and steady-state usage is well under 3k.
 */
export const ORC_BUDGET = {
  system_brand_signal: 2_500,
  summary: 800,
  verbatim: 2_000,
  current_message: 500,
  total_input: 5_000,
  total_output_target: 1_000,
} as const;

/**
 * Check whether a set of estimated-size chunks fits within the
 * per-turn ORC budget. Returns a structured result so the caller can
 * decide how to respond — summarize, truncate, or proceed.
 */
export interface BudgetCheck {
  ok: boolean;
  totalTokens: number;
  limit: number;
  /** Which section(s) blew their allocation, if any. */
  breaches: Array<
    | "system_brand_signal"
    | "summary"
    | "verbatim"
    | "current_message"
    | "total_input"
  >;
}

export interface BudgetBreakdown {
  system_brand_signal: number;
  summary: number;
  verbatim: number;
  current_message: number;
}

export function checkBudget(parts: BudgetBreakdown): BudgetCheck {
  const breaches: BudgetCheck["breaches"] = [];
  if (parts.system_brand_signal > ORC_BUDGET.system_brand_signal)
    breaches.push("system_brand_signal");
  if (parts.summary > ORC_BUDGET.summary) breaches.push("summary");
  if (parts.verbatim > ORC_BUDGET.verbatim) breaches.push("verbatim");
  if (parts.current_message > ORC_BUDGET.current_message)
    breaches.push("current_message");

  const total =
    parts.system_brand_signal +
    parts.summary +
    parts.verbatim +
    parts.current_message;
  if (total > ORC_BUDGET.total_input) breaches.push("total_input");

  return {
    ok: breaches.length === 0,
    totalTokens: total,
    limit: ORC_BUDGET.total_input,
    breaches,
  };
}
