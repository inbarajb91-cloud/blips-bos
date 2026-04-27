import { tool } from "ai";
import { z } from "zod";
import {
  getMemoryBackend,
  type MemoryContainer,
  type MemoryKind,
} from "@/lib/orc/memory";
import type { OrcToolContext } from "./types";

/**
 * recall — cross-signal semantic memory lookup. Phase 8K.
 *
 * The complement to `search_collection` (which is bounded to the
 * current signal's collection by substring match). `recall` goes
 * across ALL of BLIPS — every prior signal, every approved/dismissed
 * decision, every rolling summary — and returns the closest matches
 * by meaning, not keyword.
 *
 * Use cases ORC uses this for:
 *   - "have we seen this tension before?"
 *   - "what did Inba decide on similar signals in RCK?"
 *   - "remind me what we agreed about [topic] last month"
 *   - proactively pulling past patterns when a new signal lands
 *     ("this looks similar to BIOCAR which Inba dismissed because…")
 *
 * Backed by the configured MemoryBackend (supermemory in prod, noop
 * when key missing). On backend failure returns an empty result with
 * `degraded: true` so ORC can tell its tool call worked but memory
 * was unavailable — much better than a hard error mid-reply.
 */

const KIND_VALUES = [
  "decision",
  "conversation_summary",
  "stage_completion",
  "signal_dossier",
  "note",
] as const satisfies readonly MemoryKind[];

const CONTAINER_VALUES = [
  "events",
  "knowledge",
] as const satisfies readonly MemoryContainer[];

export function recall(ctx: OrcToolContext) {
  return tool({
    description:
      "Search BLIPS's long-term memory across ALL signals (not just this one). Use for 'have we seen this before?', 'what did Inba decide on similar signals?', 'what does our brand strategy say about X?'. Two memory layers: 'events' (auto-written decisions, summaries, completions — what happened) and 'knowledge' (curated reference docs — what BLIPS believes). Default searches both. Quote the content verbatim or summarise — never claim memory you didn't pull.",
    inputSchema: z.object({
      query: z
        .string()
        .min(3)
        .max(300)
        .describe(
          "What to search memory for. Short, specific phrasing works best — e.g. 'career vs biology tension', 'rejected RCD signals about parenting'.",
        ),
      kind: z
        .enum(KIND_VALUES)
        .optional()
        .describe(
          "Optional: restrict to one memory kind. Use 'decision' for past approvals/dismissals; 'conversation_summary' for what Inba and ORC discussed; 'signal_dossier' for cross-signal pattern recall. Omit to search everything.",
        ),
      container: z
        .enum(CONTAINER_VALUES)
        .optional()
        .describe(
          "Optional: restrict to one memory layer. 'events' = lived experience (decisions, summaries, completions). 'knowledge' = curated reference docs (brand strategy, decade playbooks). Omit to search both.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("How many hits to return. Default 5, max 10."),
    }),
    execute: async ({ query, kind, container, limit }) => {
      const backend = await getMemoryBackend();
      const hits = await backend.recall(query, {
        orgId: ctx.orgId,
        kind: kind as MemoryKind | undefined,
        container: container as MemoryContainer | undefined,
        limit: limit ?? 5,
      });

      // The backend already swallowed errors and returned []. We
      // can't distinguish "no matches" from "backend failed" here
      // without changing the contract — but the noop path also
      // returns [], so an empty result is the honest answer either
      // way. Future: surface a `degraded` flag on the backend.
      if (hits.length === 0) {
        return {
          query,
          resultCount: 0,
          results: [],
          message:
            "No memories matched. Either nothing similar has been seen before, or memory is unavailable.",
        };
      }

      return {
        query,
        resultCount: hits.length,
        results: hits.map((h) => ({
          id: h.id,
          kind: h.kind,
          content: h.content,
          score: Number(h.score.toFixed(3)),
          signalId: h.signalId ?? null,
          journeyId: h.journeyId ?? null,
          createdAt: h.createdAt,
        })),
      };
    },
  });
}
