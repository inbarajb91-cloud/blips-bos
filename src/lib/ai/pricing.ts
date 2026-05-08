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

// ─── Image generation pricing — Phase 11A ─────────────────────────
//
// Image gen is priced per-image, not per-token. Different surface from
// the text PRICING table above. Used by BOILER's logger to compute
// cost per concept generation.
//
// Pricing per provider's published rates as of the date noted next to
// each entry. Updated when provider prices change. Quality tier ("high"
// quality on gpt-image-1) noted separately since cost varies with size +
// quality settings.

export interface ImagePrice {
  /** USD per generated image at the noted size. */
  perImage: number;
  /** Note about size / quality tier this price applies to. */
  notes?: string;
}

export const IMAGE_PRICING: Record<string, ImagePrice> = {
  // OpenAI — gpt-image-1 (formerly DALL-E 3)
  "gpt-image-1": { perImage: 0.04, notes: "1024x1024 standard quality (May 2026 rates)" },
  "gpt-image-1-mini": { perImage: 0.02, notes: "1024x1024 standard" },
  "gpt-image-1.5": { perImage: 0.05, notes: "1024x1024 standard; ~25% premium over 1.0" },
  "dall-e-3": { perImage: 0.04, notes: "1024x1024 standard; legacy" },
  "dall-e-2": { perImage: 0.02, notes: "1024x1024; legacy, lower quality" },

  // Google — Imagen 4 family
  "imagen-4.0-generate-001": { perImage: 0.04, notes: "1024x1024 standard" },
  "imagen-4.0-ultra-generate-001": { perImage: 0.06, notes: "1024x1024 ultra quality" },
  "imagen-4.0-fast-generate-001": { perImage: 0.02, notes: "1024x1024 fast tier" },
  "gemini-2.5-flash-image": { perImage: 0.039, notes: "Multi-modal image gen" },
  "gemini-3-pro-image-preview": { perImage: 0.05, notes: "Preview rate (subject to change)" },
  "gemini-3.1-flash-image-preview": { perImage: 0.025, notes: "Preview rate" },

  // fal.ai — Flux 1.1 Pro Ultra (premium aesthetic tier)
  "fal/flux-1.1-pro-ultra": { perImage: 0.06, notes: "Best aesthetic; via fal.ai endpoint" },
  "fal/flux-1.1-pro": { perImage: 0.04, notes: "Standard Flux Pro" },
  "fal/ideogram-v3": { perImage: 0.08, notes: "Best for type-in-image rendering" },
  "fal/stable-diffusion-3.5-large": { perImage: 0.02, notes: "Cheapest open-weights tier" },

  // Replicate — same models, slightly different prices
  "replicate/black-forest-labs/flux-1.1-pro-ultra": { perImage: 0.07, notes: "Replicate markup vs fal.ai" },
  "replicate/ideogram-ai/ideogram-v3": { perImage: 0.09 },

  // OpenRouter image endpoints (pass-through with small markup)
  "openrouter-image/black-forest-labs/flux-1.1-pro-ultra": { perImage: 0.065 },
  "openrouter-image/ideogram-ai/ideogram-v3": { perImage: 0.085 },
};

/**
 * Compute the USD cost for N image generations of a given model. Used
 * by the BOILER logger (Phase 11C) to write agent_logs.cost_usd. Unknown
 * models log cost = 0; same forgiving pattern as the text computeCost.
 */
export function computeImageCost(model: string, imageCount: number): number {
  const price = IMAGE_PRICING[model];
  if (!price) return 0;
  return price.perImage * imageCount;
}
