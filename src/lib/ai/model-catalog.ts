/**
 * Curated model catalog — Phase 3.5.
 *
 * Drop-down hints for the agent-models settings UI. Picking from this
 * list is convenient; free-text entry of any provider/model string is
 * also allowed (the router validates via providers.ts at call time).
 *
 * Pricing here is sourced from each provider's published rates as of
 * the date noted next to each entry. When a provider adjusts pricing,
 * update the entry + add the same key to `pricing.ts` if absent.
 *
 * Display ordering: providers in PROVIDERS order; models within a
 * provider sorted by price tier (cheapest first), then alphabetically.
 *
 * NOT exhaustive — the catalog is curated. If you want to test a model
 * not listed here, type its full provider-prefixed string into the UI
 * and the router will dispatch it. Add it to this catalog after
 * verification so it shows up in the dropdown for next time.
 */

import type { ProviderId } from "./providers";

export interface CatalogModel {
  /** The exact string passed to `getModel()` and stored in config_agents.model */
  id: string;
  provider: ProviderId;
  displayName: string;
  /** Short tagline shown next to the option for context */
  hint?: string;
  /** USD per 1M input tokens (rough; real billing in pricing.ts) */
  pricePer1MInput?: number;
  pricePer1MOutput?: number;
  /** Best-fit roles. Used by the bulk-apply UI to suggest sensible
   *  defaults per agent (e.g. "high reasoning" agents → ORC/FURNACE). */
  bestFor?: Array<"reasoning" | "extraction" | "creative" | "structured" | "fast">;
}

export const CATALOG: CatalogModel[] = [
  // ─── Google Gemini ───────────────────────────────────────────
  {
    id: "gemini-2.5-flash-lite",
    provider: "google",
    displayName: "Gemini 2.5 Flash Lite",
    hint: "Cheapest Gemini, fast extraction",
    pricePer1MInput: 0.04,
    pricePer1MOutput: 0.15,
    bestFor: ["extraction", "fast"],
  },
  {
    id: "gemini-2.5-flash",
    provider: "google",
    displayName: "Gemini 2.5 Flash",
    hint: "Default for fast skills (BUNKER/STOKER)",
    pricePer1MInput: 0.075,
    pricePer1MOutput: 0.3,
    bestFor: ["extraction", "structured", "fast"],
  },
  {
    id: "gemini-2.5-pro",
    provider: "google",
    displayName: "Gemini 2.5 Pro",
    hint: "Default for judgment skills (ORC/FURNACE/BOILER)",
    pricePer1MInput: 1.25,
    pricePer1MOutput: 5.0,
    bestFor: ["reasoning", "creative", "structured"],
  },
  {
    id: "gemini-3.1-flash-lite",
    provider: "google",
    displayName: "Gemini 3.1 Flash Lite",
    hint: "Newest cheap-tier — verify availability before bulk-applying",
    pricePer1MInput: 0.05,
    pricePer1MOutput: 0.2,
    bestFor: ["extraction", "fast"],
  },

  // ─── Anthropic Claude ────────────────────────────────────────
  {
    id: "claude-haiku-4.5",
    provider: "anthropic",
    displayName: "Claude Haiku 4.5",
    hint: "Cheap + fast Claude, prompt caching is excellent here",
    pricePer1MInput: 0.25,
    pricePer1MOutput: 1.25,
    bestFor: ["extraction", "fast"],
  },
  {
    id: "claude-sonnet-4.7",
    provider: "anthropic",
    displayName: "Claude Sonnet 4.7",
    hint: "Balanced — strong tool use, agentic workflows",
    pricePer1MInput: 3.0,
    pricePer1MOutput: 15.0,
    bestFor: ["reasoning", "structured"],
  },
  {
    id: "claude-opus-4.7",
    provider: "anthropic",
    displayName: "Claude Opus 4.7",
    hint: "Highest reasoning, expensive — reserve for hardest calls",
    pricePer1MInput: 15.0,
    pricePer1MOutput: 75.0,
    bestFor: ["reasoning", "creative"],
  },

  // ─── OpenAI ──────────────────────────────────────────────────
  {
    id: "gpt-5-mini",
    provider: "openai",
    displayName: "GPT-5 Mini",
    hint: "OpenAI's cheap tier, comparable to Claude Haiku",
    pricePer1MInput: 0.25,
    pricePer1MOutput: 2.0,
    bestFor: ["extraction", "fast"],
  },
  {
    id: "gpt-5",
    provider: "openai",
    displayName: "GPT-5",
    hint: "Strong reasoning, comparable to Claude Sonnet",
    pricePer1MInput: 5.0,
    pricePer1MOutput: 15.0,
    bestFor: ["reasoning", "creative", "structured"],
  },

  // ─── xAI ─────────────────────────────────────────────────────
  {
    id: "grok-4",
    provider: "xai",
    displayName: "Grok 4",
    hint: "xAI flagship — strong reasoning, fast inference",
    pricePer1MInput: 3.0,
    pricePer1MOutput: 15.0,
    bestFor: ["reasoning", "creative"],
  },

  // ─── OpenRouter (broad catalog via single key) ───────────────
  {
    id: "openrouter/moonshotai/kimi-k2",
    provider: "openrouter",
    displayName: "Kimi K2 (via OpenRouter)",
    hint: "Cheap, strong long-context (200k+); good for big-context tasks",
    pricePer1MInput: 0.5,
    pricePer1MOutput: 2.0,
    bestFor: ["reasoning", "structured"],
  },
  {
    id: "openrouter/deepseek/deepseek-chat",
    provider: "openrouter",
    displayName: "DeepSeek Chat (via OpenRouter)",
    hint: "Very cheap, surprisingly strong reasoning",
    pricePer1MInput: 0.27,
    pricePer1MOutput: 1.1,
    bestFor: ["reasoning", "extraction"],
  },
  {
    id: "openrouter/meta-llama/llama-3.3-70b-instruct",
    provider: "openrouter",
    displayName: "Llama 3.3 70B (via OpenRouter)",
    hint: "Open-weights, cheap, decent extraction",
    pricePer1MInput: 0.13,
    pricePer1MOutput: 0.4,
    bestFor: ["extraction", "fast"],
  },

  // ─── Moonshot AI native (Kimi) ───────────────────────────────
  {
    id: "moonshot/kimi-k2-instruct",
    provider: "moonshot",
    displayName: "Kimi K2 Instruct (native)",
    hint: "Direct Moonshot API, cheaper than via OpenRouter",
    pricePer1MInput: 0.2,
    pricePer1MOutput: 1.0,
    bestFor: ["reasoning", "structured"],
  },
];

/**
 * Group catalog by provider for the UI dropdown.
 */
export function groupByProvider(): Record<ProviderId, CatalogModel[]> {
  const out: Partial<Record<ProviderId, CatalogModel[]>> = {};
  for (const m of CATALOG) {
    if (!out[m.provider]) out[m.provider] = [];
    out[m.provider]!.push(m);
  }
  return out as Record<ProviderId, CatalogModel[]>;
}

/**
 * Lookup a curated model by id. Returns undefined for free-text /
 * uncatalogued models (still callable via the router, just no UI hint).
 */
export function findCatalogModel(id: string): CatalogModel | undefined {
  return CATALOG.find((m) => m.id === id);
}
