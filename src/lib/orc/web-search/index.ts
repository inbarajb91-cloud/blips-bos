import type { WebSearchBackend } from "./types";
import { createGeminiGroundedBackend } from "./gemini-grounded";
import { createNoopWebSearchBackend } from "./noop";

/**
 * Web search backend resolver.
 *
 * Returns a singleton backend instance. Default is Gemini grounded
 * search (gemini-grounded.ts) when GOOGLE_GENERATIVE_AI_API_KEY is
 * present; otherwise falls through to the noop backend so ORC's tool
 * returns a clean degraded result instead of throwing.
 *
 * Future: introduce a backend selector env var (e.g.
 * WEB_SEARCH_BACKEND=tavily) + matching implementations as siblings.
 * Today the seam exists; only the Gemini-grounded path is wired by
 * deliberate decision (resource-discipline + reuse of shipped code).
 */

let cached: WebSearchBackend | null = null;

export function getWebSearchBackend(): WebSearchBackend {
  if (cached) return cached;

  const hasGeminiKey = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  cached = hasGeminiKey
    ? createGeminiGroundedBackend()
    : createNoopWebSearchBackend();

  return cached;
}

/**
 * Reset the singleton — for tests only. Not exported from the public
 * surface by convention; importers grab it directly from this file.
 */
export function __resetWebSearchBackendForTests(): void {
  cached = null;
}

export type {
  WebSearchBackend,
  WebSearchResult,
  WebSearchSource,
} from "./types";
