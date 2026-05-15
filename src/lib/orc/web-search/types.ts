/**
 * Web search backend interface — Phase 11.5 (ORC web_search tool).
 *
 * Mirrors the MemoryBackend pattern (src/lib/orc/memory/types.ts):
 * a swappable seam so ORC's web_search tool isn't coupled to any
 * single search provider. Day-one default is Gemini grounded search
 * (gemini-grounded.ts, reuses the BUNKER reference-mode pattern);
 * alternative implementations (Anthropic web_search subroutine,
 * Tavily, etc.) drop in as siblings without touching the tool code.
 *
 * Why a seam at all when ORC's chat model is already pluggable: ORC's
 * model can be swapped in Settings + a fallback chain serves a
 * different model mid-turn if the primary is down. Wiring a native
 * provider search tool directly into ORC's stream would couple ORC's
 * search capability to whichever model served the turn (and fully
 * disable it on OpenAI-compatible providers, which have no native
 * search). The seam keeps ORC's `web_search` tool stable regardless
 * of the chat model — the actual search runs as a contained subroutine
 * underneath.
 */

/** A single source surfaced by the search backend. */
export interface WebSearchSource {
  /** Page / article title as the search backend rendered it. */
  title: string;
  /** Canonical URL the digest is referencing. */
  url: string;
}

/**
 * Bounded result returned to ORC's tool execute. Result size is
 * controlled by the backend so it never blows ORC's per-turn token
 * budget (which is tight — see the 413 incident history in MEMORY.md).
 */
export interface WebSearchResult {
  /** The query as the user / ORC posed it. Echoed back so logs + ORC
   *  context show what was searched. */
  query: string;
  /**
   * Concise research digest synthesized from live web content — not
   * raw SERP results. Bounded ~1500 chars by the backend.
   */
  digest: string;
  /**
   * Source list backing the digest. Bounded (≤8). ORC must cite these
   * by URL when quoting facts from the digest.
   */
  sources: WebSearchSource[];
  /**
   * True when the backend is unavailable (missing key, transient
   * outage, noop fallback). The digest will be a clear "search
   * unavailable" message rather than throwing, so ORC can recover
   * gracefully within the turn. False / undefined on success.
   */
  degraded?: boolean;
}

/**
 * The seam — every backend implements this.
 *
 * Throwing is forbidden. Errors must surface as a degraded result
 * (`{ degraded: true, digest: "...explanation...", sources: [] }`) so
 * the tool's `execute` returns a clean value to ORC's tool runtime
 * and ORC can mention the failure in its reply instead of erroring
 * out mid-stream.
 */
export interface WebSearchBackend {
  search(query: string): Promise<WebSearchResult>;
}
