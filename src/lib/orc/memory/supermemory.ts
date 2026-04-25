import Supermemory from "supermemory";
import type {
  MemoryBackend,
  MemoryHit,
  MemoryItem,
  MemoryKind,
  RecallScope,
} from "./types";

/**
 * Supermemory backend — Phase 8K.
 *
 * Thin wrapper around the `supermemory` npm package (v4.21+). Translates
 * our MemoryBackend contract into supermemory's actual API:
 *   - WRITE: `client.documents.add({content, containerTag, metadata})` —
 *     supermemory ingests the doc, extracts memories from it, indexes
 *     them. We submit one document per "memory" because each remember()
 *     call carries a single semantic fact.
 *   - READ: `client.search.memories({q, containerTag, ...})` — low-
 *     latency conversational search. Returns extracted memory entries
 *     ranked by similarity.
 *
 * Tenant scoping uses supermemory's `containerTag` primitive. We tag
 * every document with `org-{orgId}` so cross-org leaks are impossible
 * at the API boundary, not just at our app code. Sub-org scoping
 * (kind / signal / journey / collection) lives in metadata, which we
 * post-filter in JS — fine at our hit volume.
 *
 * Failure philosophy: ALL errors are swallowed. Memory must never
 * break ORC's reply path. We log to console for now; a future hook
 * could push to agent_logs once we want richer observability.
 *
 * Note on the v4 API shift: supermemory's earlier docs showed
 * `client.memories.add()` — that was deprecated. The Memories
 * resource now only does forget/updateMemory on extracted entries.
 * Adding new content always goes through documents.
 */

export interface SupermemoryBackendOptions {
  apiKey: string;
  /** Override base URL when pointing at a non-prod supermemory env. */
  baseURL?: string;
}

export class SupermemoryBackend implements MemoryBackend {
  private client: Supermemory;

  constructor(opts: SupermemoryBackendOptions) {
    this.client = new Supermemory({
      apiKey: opts.apiKey,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    });
  }

  async remember(item: MemoryItem): Promise<{ id: string }> {
    try {
      // containerTag is supermemory's tenant boundary. Single string,
      // alphanumeric + hyphens/underscores/dots, max 100 chars.
      // UUIDs fit cleanly with an `org-` prefix for human-readability
      // in their dashboard.
      const containerTag = `org-${item.orgId}`;

      // Metadata values can only be primitives or string[]. We store
      // kind + the various IDs as strings so we can post-filter on
      // recall. Anything caller passed in extra metadata gets merged
      // last but wins on key collision.
      const metadata: Record<string, string | number | boolean | string[]> = {
        kind: item.kind,
      };
      if (item.signalId) metadata.signalId = item.signalId;
      if (item.journeyId) metadata.journeyId = item.journeyId;
      if (item.collectionId) metadata.collectionId = item.collectionId;
      if (item.metadata) {
        for (const [k, v] of Object.entries(item.metadata)) {
          // Coerce only the supported primitive shapes through.
          if (
            typeof v === "string" ||
            typeof v === "number" ||
            typeof v === "boolean"
          ) {
            metadata[k] = v;
          } else if (
            Array.isArray(v) &&
            v.every((x) => typeof x === "string")
          ) {
            metadata[k] = v as string[];
          }
          // else: silently drop — supermemory metadata can't hold it
        }
      }

      const result = await this.client.documents.add({
        content: item.content,
        containerTag,
        metadata,
      });

      return { id: String(result.id ?? "") };
    } catch (err) {
      console.error("[memory] supermemory.remember failed:", err);
      return { id: "" };
    }
  }

  async recall(
    query: string,
    scope: RecallScope,
  ): Promise<MemoryHit[]> {
    try {
      const containerTag = `org-${scope.orgId}`;
      const limit = scope.limit ?? 5;

      // Over-fetch when sub-org filters are present, so post-filter
      // still leaves us with `limit` hits in most cases. Cap at 25
      // to stay well within supermemory's per-call quotas.
      const wantPostFilter =
        Boolean(scope.signalId || scope.journeyId || scope.collectionId) ||
        Boolean(scope.kind);
      const fetchLimit = wantPostFilter ? Math.min(limit * 4, 25) : limit;

      const result = await this.client.search.memories({
        q: query,
        containerTag,
        limit: fetchLimit,
        // rerank improves quality at +200-300ms latency. Worth it
        // for ORC's recall use case — we only call this when ORC
        // explicitly needs memory, so latency budget is forgiving.
        rerank: true,
      });

      const raw = result.results ?? [];

      const filtered = raw.filter((r) => {
        const m = (r.metadata ?? {}) as Record<string, unknown>;
        if (scope.kind) {
          const kinds = Array.isArray(scope.kind)
            ? scope.kind
            : [scope.kind];
          if (!kinds.includes(m.kind as MemoryKind)) return false;
        }
        if (scope.signalId && m.signalId !== scope.signalId) return false;
        if (scope.journeyId && m.journeyId !== scope.journeyId) return false;
        if (scope.collectionId && m.collectionId !== scope.collectionId) {
          return false;
        }
        return true;
      });

      return filtered.slice(0, limit).map((r) => {
        const m = (r.metadata ?? {}) as Record<string, unknown>;
        return {
          id: String(r.id ?? ""),
          // For SearchMemoriesResponse, `memory` is the extracted
          // memory text; `chunk` is set on document-chunk results
          // from hybrid mode. We're in 'memories' mode by default,
          // so prefer .memory and fall back to .chunk just in case.
          content: String(r.memory ?? r.chunk ?? ""),
          kind: ((m.kind as MemoryKind | undefined) ?? "note") as MemoryKind,
          score: typeof r.similarity === "number" ? r.similarity : 0,
          signalId:
            typeof m.signalId === "string" ? m.signalId : undefined,
          journeyId:
            typeof m.journeyId === "string" ? m.journeyId : undefined,
          collectionId:
            typeof m.collectionId === "string"
              ? m.collectionId
              : undefined,
          metadata: m,
          createdAt: String(r.updatedAt ?? new Date().toISOString()),
        };
      });
    } catch (err) {
      console.error("[memory] supermemory.recall failed:", err);
      return [];
    }
  }
}
