/**
 * LLM pricing table — USD per 1M tokens.
 *
 * Used by the logger to compute `cost_usd` per agent_logs row, which feeds
 * the REVIEWS.md phase retros and the eventual Billing & Usage page.
 *
 * Keep current: when a provider changes pricing, update here + note in MEMORY.md.
 * When adding a new model, add an entry here before the first call.
 */

export interface ModelPrice {
  input: number; // USD per 1M input tokens
  output: number; // USD per 1M output tokens
  cachedInput?: number; // USD per 1M cached input tokens (90% discount typically)
}

export const PRICING: Record<string, ModelPrice> = {
  // ─── Anthropic Claude ──────────────────────────────────
  "claude-haiku-4.5": { input: 0.25, output: 1.25, cachedInput: 0.03 },
  "claude-sonnet-4.7": { input: 3.0, output: 15.0, cachedInput: 0.3 },
  "claude-opus-4.7": { input: 15.0, output: 75.0, cachedInput: 1.5 },

  // ─── Google Gemini ─────────────────────────────────────
  // Pricing estimates — update as Google publishes current rates.
  // Unknown entries = cost logs zero (pipeline still works, just no cost tracked).
  "gemini-2.5-flash": { input: 0.075, output: 0.3 },
  "gemini-2.5-flash-lite": { input: 0.04, output: 0.15 },
  "gemini-2.5-pro": { input: 1.25, output: 5.0 },
  "gemini-2.0-flash": { input: 0.075, output: 0.3 },
  "gemini-2.0-flash-lite": { input: 0.04, output: 0.15 },
  "gemini-2.0-flash-exp": { input: 0.0, output: 0.0 }, // experimental = free tier
  "gemini-3-flash": { input: 0.1, output: 0.4 }, // estimate pending publication
  "gemini-3.1-flash-lite": { input: 0.05, output: 0.2 }, // estimate pending publication

  // ─── Fallbacks (OpenAI, if enabled later) ──────────────
  "gpt-5": { input: 5.0, output: 15.0 },
  "gpt-5-mini": { input: 0.25, output: 2.0 },
};

export function computeCost(
  model: string,
  tokensInput: number,
  tokensOutput: number,
  cachedTokens = 0,
): number {
  const price = PRICING[model];
  if (!price) {
    // Unknown model — log zero, don't throw. MEMORY.md should add pricing next phase.
    return 0;
  }

  const uncachedInput = tokensInput - cachedTokens;
  const inputCost = (uncachedInput * price.input) / 1_000_000;
  const cachedCost =
    cachedTokens > 0 && price.cachedInput
      ? (cachedTokens * price.cachedInput) / 1_000_000
      : 0;
  const outputCost = (tokensOutput * price.output) / 1_000_000;

  return inputCost + cachedCost + outputCost;
}
