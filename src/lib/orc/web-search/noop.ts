import type { WebSearchBackend, WebSearchResult } from "./types";

/**
 * No-op WebSearchBackend.
 *
 * Used when GOOGLE_GENERATIVE_AI_API_KEY is absent (local dev without
 * the key, isolated test environments). Returns a clear degraded
 * result rather than throwing so the ORC tool reports "search
 * unavailable" cleanly and ORC can recover within the turn.
 *
 * Mirrors src/lib/orc/memory/noop.ts — same fail-soft contract.
 */
class NoopWebSearchBackend implements WebSearchBackend {
  async search(query: string): Promise<WebSearchResult> {
    return {
      query,
      digest:
        "Web search is not configured for this environment (GOOGLE_GENERATIVE_AI_API_KEY not set). Skip and proceed.",
      sources: [],
      degraded: true,
    };
  }
}

export function createNoopWebSearchBackend(): WebSearchBackend {
  return new NoopWebSearchBackend();
}
