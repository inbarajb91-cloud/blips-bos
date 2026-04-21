/**
 * Uniform shape every source connector implements.
 *
 * BUNKER doesn't care where a candidate came from — Reddit post, RSS feed
 * article, NewsAPI headline, or Trends query. The connector normalizes raw
 * source data into this shape; BUNKER extracts the signal.
 *
 * Each connector lives in `src/lib/sources/<source>.ts` and exports a
 * function conforming to `SourceConnector`.
 */

import type { signalSource } from "@/db/schema";

/** All possible source values (matches DB enum). */
export type SourceKind = (typeof signalSource.enumValues)[number];

/** Raw candidate yielded by a source, before BUNKER extraction. */
export interface RawCandidate {
  /** Which source produced this */
  source: SourceKind;

  /** Canonical URL where this content lives (used for dedup + provenance) */
  url?: string;

  /** Headline / post title */
  title: string;

  /** Full body text — truncated to ~1000 chars at the connector level to
   * keep BUNKER's input size sane and minimize token cost */
  body: string;

  /** Source-specific metadata (subreddit, upvotes, author, etc.) — stored
   * on `bunker_candidates.raw_metadata` as jsonb for later inspection */
  metadata: Record<string, unknown>;

  /** Optional per-source timestamp (publication time) — when available */
  publishedAt?: Date;
}

/**
 * A source connector — takes an org (for config lookups and logging) plus
 * optional query params, returns an array of raw candidates.
 *
 * Connectors should:
 * - Rate-limit themselves per source rules
 * - Pre-filter using source-specific heuristics (Reddit upvote threshold,
 *   RSS source allowlist, NewsAPI keyword match) — see ARCHITECTURE.md's
 *   token efficiency strategy, point 1
 * - Truncate body text at ~1000 chars before returning
 * - Return empty array on error (log internally; don't crash collection run)
 */
export type SourceConnector = (params: {
  orgId: string;
  /** Optional: specific query terms, subreddit list, etc. — connector-specific */
  query?: Record<string, unknown>;
  /** Max candidates to return from this run */
  limit?: number;
}) => Promise<RawCandidate[]>;
