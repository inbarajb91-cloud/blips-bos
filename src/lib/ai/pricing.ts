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

  // ─── OpenAI ────────────────────────────────────────────
  "gpt-5": { input: 5.0, output: 15.0 },
  "gpt-5-mini": { input: 0.25, output: 2.0 },
  "gpt-4o": { input: 2.5, output: 10.0, cachedInput: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cachedInput: 0.075 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "o1": { input: 15.0, output: 60.0 },
  "o1-mini": { input: 1.1, output: 4.4 },
  "o3-mini": { input: 1.1, output: 4.4 },

  // ─── xAI ───────────────────────────────────────────────
  "grok-2": { input: 2.0, output: 10.0 },
  "grok-3": { input: 3.0, output: 15.0 },
  "grok-4": { input: 3.0, output: 15.0 },

  // ─── OpenRouter (prices per OpenRouter's published rates;
  //     provider sometimes adds a small markup) ────────────
  // Use the full provider-prefixed string as the lookup key so the
  // pricing layer can match the same id we pass to getModel().
  "openrouter/moonshotai/kimi-k2": { input: 0.5, output: 2.0 },
  "openrouter/moonshotai/kimi-k2-instruct": { input: 0.5, output: 2.0 },
  "openrouter/deepseek/deepseek-chat": { input: 0.27, output: 1.1 },
  "openrouter/deepseek/deepseek-r1": { input: 0.55, output: 2.19 },
  "openrouter/meta-llama/llama-3.3-70b-instruct": { input: 0.13, output: 0.4 },
  "openrouter/mistralai/mistral-large": { input: 2.0, output: 6.0 },
  "openrouter/openai/gpt-4o": { input: 2.5, output: 10.0 },
  "openrouter/anthropic/claude-sonnet-4.7": { input: 3.0, output: 15.0 },

  // ─── Moonshot AI native (Kimi) — cheaper than via OpenRouter ──
  "moonshot/kimi-k2-instruct": { input: 0.2, output: 1.0 },
  "moonshot/moonshot-v1-128k": { input: 1.0, output: 3.0 },

  // ─── Groq (open-weights, very fast) ────────────────────
  "groq/llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "groq/kimi-k2-instruct": { input: 1.0, output: 3.0 },
  "groq/mixtral-8x7b-32768": { input: 0.24, output: 0.24 },

  // ─── Together AI ───────────────────────────────────────
  "together/meta-llama/Llama-3.3-70B-Instruct-Turbo": { input: 0.88, output: 0.88 },
  "together/Qwen/Qwen2.5-72B-Instruct-Turbo": { input: 1.2, output: 1.2 },

  // ─── Fireworks AI ──────────────────────────────────────
  "fireworks/accounts/fireworks/models/llama-v3p3-70b-instruct": { input: 0.9, output: 0.9 },
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
