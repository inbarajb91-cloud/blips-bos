/**
 * Provider registry — Phase 3.5.
 *
 * Central place where every supported LLM provider is wired. Adding a
 * new provider = add a row here; everything else (router, settings UI,
 * pricing, probe script) reads from this registry. Goal: keep model
 * support config-driven so testing a new provider stays a 1-file edit.
 *
 * Each provider exposes:
 *   - `id`: short, lowercase, stable (used as `<provider>/<model>` prefix)
 *   - `displayName`: human-readable in the settings UI
 *   - `make(modelId)`: returns an AI SDK LanguageModel for that provider
 *   - `envVar`: which env var the SDK expects to find an API key in
 *     (used by the UI to nudge "missing key" hints; nothing fails closed
 *     here — the SDK throws if invoked without a key)
 *   - `supportsStreaming`: whether streamText can use this provider's
 *     models. All current providers do; flag exists for future image/
 *     embedding-only providers that don't.
 *   - `supportsTools`: whether the provider supports AI SDK tool calls.
 *     ORC's tools require this; non-tool providers can still serve
 *     skills (BUNKER/STOKER/FURNACE/BOILER/ENGINE/PROPELLER outputs are
 *     structured generations, not tool calls).
 *   - `compatible`: optional flag — if true, requires a baseURL +
 *     custom apiKey beyond the env var (covers OpenRouter, Together,
 *     Moonshot/Kimi, Groq, Fireworks, etc. via @ai-sdk/openai-compatible).
 *     When true, the model string is just the model name; the actual
 *     endpoint is configured per-org via env or future settings.
 */

import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { xai } from "@ai-sdk/xai";
import type { LanguageModel } from "ai";

export type ProviderId =
  | "anthropic"
  | "google"
  | "openai"
  | "xai"
  | "openrouter"
  | "moonshot"
  | "groq"
  | "together"
  | "fireworks";

export interface ProviderDef {
  id: ProviderId;
  displayName: string;
  envVar: string;
  supportsStreaming: boolean;
  supportsTools: boolean;
  /** Set on OpenAI-compatible providers (OpenRouter / Moonshot / Groq /
   *  Together / Fireworks etc.). They share an API shape with OpenAI
   *  but at a different baseURL with a different auth key. */
  compatible?: { baseURL: string };
  /** Returns the AI SDK LanguageModel for the given model id. The id
   *  passed in is the BARE model name (no provider prefix). */
  make: (modelId: string) => LanguageModel;
  /** Pattern that bare model strings tend to match — used by the router
   *  to auto-detect provider when no `provider/` prefix is supplied.
   *  When two providers might match (e.g. OpenRouter exposes models
   *  with vendor prefixes like "openai/gpt-4o"), the router prefers the
   *  prefixed form, so this regex is best-effort. */
  bareModelPattern?: RegExp;
}

// ─── First-party providers (each has its own SDK) ────────────────

const ANTHROPIC: ProviderDef = {
  id: "anthropic",
  displayName: "Anthropic (Claude)",
  envVar: "ANTHROPIC_API_KEY",
  supportsStreaming: true,
  supportsTools: true,
  make: (modelId) => anthropic(modelId),
  bareModelPattern: /^claude-/i,
};

const GOOGLE: ProviderDef = {
  id: "google",
  displayName: "Google (Gemini)",
  envVar: "GOOGLE_GENERATIVE_AI_API_KEY",
  supportsStreaming: true,
  supportsTools: true,
  make: (modelId) => google(modelId),
  bareModelPattern: /^gemini-/i,
};

const OPENAI: ProviderDef = {
  id: "openai",
  displayName: "OpenAI",
  envVar: "OPENAI_API_KEY",
  supportsStreaming: true,
  supportsTools: true,
  make: (modelId) => openai(modelId),
  bareModelPattern: /^(gpt-|o[1-9])/i,
};

const XAI: ProviderDef = {
  id: "xai",
  displayName: "xAI (Grok)",
  envVar: "XAI_API_KEY",
  supportsStreaming: true,
  supportsTools: true,
  make: (modelId) => xai(modelId),
  bareModelPattern: /^grok-/i,
};

// ─── OpenAI-compatible providers (share API shape, different host) ──
//
// Each of these requires the founder to set the corresponding env var
// to the provider's API key. Adding a new compatible provider here is
// a 4-line edit: id, baseURL, displayName, envVar.

function makeCompatible(
  id: ProviderId,
  displayName: string,
  envVar: string,
  baseURL: string,
): ProviderDef {
  return {
    id,
    displayName,
    envVar,
    supportsStreaming: true,
    supportsTools: true, // most OpenAI-compatible providers support tools
    compatible: { baseURL },
    make: (modelId) => {
      const apiKey = process.env[envVar];
      if (!apiKey) {
        throw new Error(
          `Provider ${id} requires ${envVar} to be set. Add it to .env.local.`,
        );
      }
      const provider = createOpenAICompatible({
        name: id,
        baseURL,
        apiKey,
      });
      return provider(modelId);
    },
  };
}

// OpenRouter — single endpoint to access OpenAI / Anthropic / Google /
// Mistral / Kimi / DeepSeek / etc. Convenient for testing many models
// without one-key-per-provider. Models are addressed by vendor prefix
// (e.g. `openai/gpt-4o`, `anthropic/claude-sonnet-4.7`,
// `moonshotai/kimi-k2`, `mistralai/mistral-large`).
const OPENROUTER = makeCompatible(
  "openrouter",
  "OpenRouter",
  "OPENROUTER_API_KEY",
  "https://openrouter.ai/api/v1",
);

// Moonshot AI — Kimi models native API. Cheap, long context (200k+).
// Model strings like `moonshot-v1-128k`, `kimi-k2-instruct`.
const MOONSHOT = makeCompatible(
  "moonshot",
  "Moonshot AI (Kimi)",
  "MOONSHOT_API_KEY",
  "https://api.moonshot.cn/v1",
);

// Groq — extremely fast inference for open-weights models (Llama,
// Mixtral, Kimi K2 instruct, etc.). Sub-second latency.
const GROQ = makeCompatible(
  "groq",
  "Groq",
  "GROQ_API_KEY",
  "https://api.groq.com/openai/v1",
);

// Together AI — broad model catalog, often cheaper than Anthropic/OpenAI
// for similar-tier models.
const TOGETHER = makeCompatible(
  "together",
  "Together AI",
  "TOGETHER_API_KEY",
  "https://api.together.xyz/v1",
);

// Fireworks AI — similar to Together; some models exclusive.
const FIREWORKS = makeCompatible(
  "fireworks",
  "Fireworks AI",
  "FIREWORKS_API_KEY",
  "https://api.fireworks.ai/inference/v1",
);

// ─── Registry ────────────────────────────────────────────────────

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  anthropic: ANTHROPIC,
  google: GOOGLE,
  openai: OPENAI,
  xai: XAI,
  openrouter: OPENROUTER,
  moonshot: MOONSHOT,
  groq: GROQ,
  together: TOGETHER,
  fireworks: FIREWORKS,
};

export const PROVIDER_LIST: ProviderDef[] = Object.values(PROVIDERS);

/** Provider-prefix tokens recognised at the front of a model string
 *  (e.g. "openai/gpt-4o" → openai). Sorted longest-first to avoid
 *  partial-match issues when prefixes share a stem. */
const PREFIX_KEYS: Array<{ prefix: string; id: ProviderId }> = PROVIDER_LIST.map(
  (p) => ({ prefix: `${p.id}/`, id: p.id }),
).sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * Resolve a model ID string to its provider, returning the provider and
 * the bare model name (without prefix). Recognises:
 *   - "openai/gpt-4o" → { provider: openai, model: "gpt-4o" }
 *   - "openrouter/moonshotai/kimi-k2" → { provider: openrouter, model: "moonshotai/kimi-k2" }
 *   - "claude-sonnet-4.7" → bare match via ANTHROPIC.bareModelPattern
 *   - "gemini-3.1-flash-lite" → bare match via GOOGLE.bareModelPattern
 *
 * Returns null for unrecognised strings; caller decides whether to
 * throw or default.
 */
export function resolveProvider(
  modelId: string,
): { provider: ProviderDef; modelName: string } | null {
  // Prefixed form takes precedence
  for (const { prefix, id } of PREFIX_KEYS) {
    if (modelId.startsWith(prefix)) {
      return {
        provider: PROVIDERS[id],
        modelName: modelId.slice(prefix.length),
      };
    }
  }
  // Heuristic bare match
  for (const provider of PROVIDER_LIST) {
    if (provider.bareModelPattern && provider.bareModelPattern.test(modelId)) {
      return { provider, modelName: modelId };
    }
  }
  return null;
}
