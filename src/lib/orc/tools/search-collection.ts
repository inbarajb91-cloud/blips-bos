import { tool } from "ai";
import { z } from "zod";
import { and, eq, ilike, or, ne } from "drizzle-orm";
import { db, signals } from "@/db";
import type { OrcToolContext } from "./types";

/**
 * search_collection — find similar signals within the same collection
 * as the current signal. Answers "have we seen this before?" style
 * questions from the founder.
 *
 * Phase 8 MVP implementation: case-insensitive substring match on
 * working_title, concept, and raw_text. Returns up to 8 results.
 * Filters out the current signal itself so "similar to this" doesn't
 * trivially return this.
 *
 * Deferred to a later phase: swap in pg_vector semantic search over
 * signal embeddings for true "similar by meaning" retrieval. The
 * tool contract here stays the same; only the implementation
 * changes. See `src/db/schema.ts` for where to add the embedding
 * column when embeddings land.
 */

export function searchCollection(ctx: OrcToolContext) {
  return tool({
    description:
      "Search signals in the same collection as the current signal for ones matching a query. Useful when Inba asks 'have we seen this before?' or 'how does this relate to the other signals in this collection?'. Returns up to 8 matching signals with shortcode, title, concept. Use short, specific queries (3-8 words).",
    inputSchema: z.object({
      query: z
        .string()
        .min(3)
        .max(200)
        .describe("Keywords or short phrase to match against signals"),
    }),
    execute: async ({ query }) => {
      // First: find the current signal's collection_id. If it has no
      // collection (direct submission without the singleton bucket),
      // we can't scope a search — return empty.
      const [currentSignal] = await db
        .select({
          collectionId: signals.collectionId,
        })
        .from(signals)
        .where(
          and(eq(signals.id, ctx.signalId), eq(signals.orgId, ctx.orgId)),
        )
        .limit(1);

      if (!currentSignal || !currentSignal.collectionId) {
        return {
          query,
          results: [],
          message: "This signal isn't in a collection, so there's nothing to compare against.",
        };
      }

      // Substring match across the three text fields. `ilike` for
      // case-insensitive matching. The leading/trailing % wildcards
      // accept the query anywhere in the field. Not a performance
      // concern at BLIPS scale (hundreds of signals).
      const pattern = `%${query}%`;
      const rows = await db
        .select({
          id: signals.id,
          shortcode: signals.shortcode,
          workingTitle: signals.workingTitle,
          concept: signals.concept,
          status: signals.status,
        })
        .from(signals)
        .where(
          and(
            eq(signals.orgId, ctx.orgId),
            eq(signals.collectionId, currentSignal.collectionId),
            ne(signals.id, ctx.signalId),
            or(
              ilike(signals.workingTitle, pattern),
              ilike(signals.concept, pattern),
              ilike(signals.rawText, pattern),
            ),
          ),
        )
        .limit(8);

      return {
        query,
        collectionId: currentSignal.collectionId,
        resultCount: rows.length,
        results: rows,
      };
    },
  });
}
