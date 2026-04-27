import Supermemory from "supermemory";
import type {
  MemoryBackend,
  MemoryContainer,
  MemoryHit,
  MemoryItem,
  MemoryKind,
  RecallScope,
} from "./types";

/**
 * Map a (orgId, container) pair to a supermemory containerTag. The
 * 'test' container gets its own supermemory tenant entirely — that's
 * the wall that stops smoke-test pollution from ever leaking into
 * production recall.
 *
 *   events    → 'org-{orgId}'         (production)
 *   knowledge → 'org-{orgId}'         (production, distinguished by metadata.container)
 *   test      → 'org-test-{orgId}'    (separate supermemory tenant)
 */
function containerTagFor(orgId: string, container: MemoryContainer): string {
  if (container === "test") return `org-test-${orgId}`;
  return `org-${orgId}`;
}

/**
 * Redact an SDK error before logging. The supermemory SDK throws
 * rich error objects that include the original request payload + headers
 * (including the Authorization header carrying our API key) and the
 * full response body. Logging the raw object would leak credentials
 * and memory content into application logs.
 *
 * Returns a small safe shape with: message, name, status code, and
 * optional supermemory-specific error.error string when present.
 * Stack is included in dev for debugging but skipped in production
 * to keep log volume sane.
 *
 * CodeRabbit pass 7 — security hardening.
 */
function safeError(err: unknown): {
  name: string;
  message: string;
  status?: number;
  code?: string;
  errorBody?: string;
  stack?: string;
} {
  if (err instanceof Error) {
    const out: ReturnType<typeof safeError> = {
      name: err.name,
      message: err.message,
    };
    // Many SDK error classes attach .status, .code, and .error fields.
    // Read defensively without tripping on missing types.
    const anyErr = err as Error & {
      status?: unknown;
      code?: unknown;
      error?: { error?: unknown };
    };
    if (typeof anyErr.status === "number") out.status = anyErr.status;
    if (typeof anyErr.code === "string") out.code = anyErr.code;
    if (
      anyErr.error &&
      typeof anyErr.error === "object" &&
      typeof anyErr.error.error === "string"
    ) {
      // Surface supermemory's own error message string (e.g.
      // "Document is still processing") without dragging the full
      // body. This is safe to log — it's the user-facing reason.
      out.errorBody = anyErr.error.error;
    }
    if (
      process.env.NODE_ENV !== "production" &&
      typeof err.stack === "string"
    ) {
      out.stack = err.stack;
    }
    return out;
  }
  return { name: "UnknownError", message: String(err) };
}

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
      const container: MemoryContainer = item.container ?? "events";
      const containerTag = containerTagFor(item.orgId, container);

      // Metadata values can only be primitives or string[]. We
      // serialize caller metadata FIRST (lowest priority), then
      // overwrite with reserved wrapper keys (kind / container /
      // signalId / journeyId / collectionId) LAST so caller can never
      // shadow them. Pre-CodeRabbit-pass-6 the order was reversed —
      // a caller passing {kind: "..."} or {container: "..."} in
      // their metadata could break recall scoping. Now those fields
      // are wrapper invariants.
      const metadata: Record<string, string | number | boolean | string[]> = {};
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
      // Reserved wrapper keys assigned LAST so they win on collision.
      metadata.kind = item.kind;
      metadata.container = container;
      if (item.signalId) metadata.signalId = item.signalId;
      if (item.journeyId) metadata.journeyId = item.journeyId;
      if (item.collectionId) metadata.collectionId = item.collectionId;

      const result = await this.client.documents.add({
        content: item.content,
        containerTag,
        metadata,
      });

      return { id: String(result.id ?? "") };
    } catch (err) {
      console.error("[memory] supermemory.remember failed:", safeError(err));
      return { id: "" };
    }
  }

  async recall(
    query: string,
    scope: RecallScope,
  ): Promise<MemoryHit[]> {
    try {
      // Container scoping: if scope.container is undefined, default
      // to the production tenant (events + knowledge, NOT test). If
      // explicitly 'test' (or includes test), we hit the isolated
      // test tenant. Mixing prod + test in one query isn't supported
      // — they live in different supermemory containerTags.
      const requestedContainers = scope.container
        ? Array.isArray(scope.container)
          ? scope.container
          : [scope.container]
        : (["events", "knowledge"] as MemoryContainer[]);

      const isTestSearch = requestedContainers.includes("test");
      if (isTestSearch && requestedContainers.length > 1) {
        console.warn(
          "[memory] recall: mixing 'test' with other containers is unsupported; using test only",
        );
      }
      const containerTag = isTestSearch
        ? `org-test-${scope.orgId}`
        : `org-${scope.orgId}`;

      // Clamp limit to sane range — pre-CodeRabbit-pass-6 a caller
      // passing 0, NaN, or a negative would silently degrade to
      // empty recalls or send invalid fetch limits to supermemory.
      // Default 5, floor 1, ceiling 50 (supermemory's own per-call
      // cap). Math.floor handles any non-integer that slips through.
      const requestedLimit = scope.limit ?? 5;
      const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(50, Math.floor(requestedLimit)))
        : 5;

      // Over-fetch when ANY post-filter applies, so the final result
      // still has `limit` hits in most cases. Cap at 25 to stay well
      // within supermemory's per-call quotas.
      const wantPostFilter =
        Boolean(scope.signalId || scope.journeyId || scope.collectionId) ||
        Boolean(scope.kind) ||
        // For production tenant, we still post-filter by metadata.container
        // when caller specified a subset (e.g. 'knowledge' only).
        (!isTestSearch &&
          requestedContainers.length === 1 &&
          requestedContainers[0] !== "events");
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
        // Always exclude transient docs from recall — these are
        // eval/test writes that exercised a real container path
        // (e.g. phase-8-evals.ts E5) but should never surface in
        // production reasoning. The eval attempts forget() right
        // after the assertion, but supermemory's async extraction
        // can race the delete; this filter is the belt to that
        // belt-and-suspenders. Accept boolean true OR string "true"
        // — supermemory may stringify metadata values on storage.
        if (m.transient === true || m.transient === "true") return false;
        if (scope.kind) {
          const kinds = Array.isArray(scope.kind)
            ? scope.kind
            : [scope.kind];
          if (!kinds.includes(m.kind as MemoryKind)) return false;
        }
        // Container filter (only relevant for production tenant where
        // both events + knowledge live behind the same containerTag).
        if (!isTestSearch) {
          const c = (m.container ?? "events") as MemoryContainer;
          if (!requestedContainers.includes(c)) return false;
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
          // Pre-CodeRabbit-pass-6 we synthesized `now()` when the
          // backend didn't return a timestamp — that misrepresents
          // chronology in downstream prompts/UX. Now we surface
          // null so consumers can treat "unknown" honestly. Type
          // updated in MemoryHit accordingly.
          createdAt:
            typeof r.updatedAt === "string" && r.updatedAt.length > 0
              ? r.updatedAt
              : null,
        };
      });
    } catch (err) {
      console.error("[memory] supermemory.recall failed:", safeError(err));
      return [];
    }
  }

  async forget(id: string): Promise<void> {
    if (!id) return;
    try {
      await this.client.documents.delete(id);
    } catch (err) {
      // Same swallow-and-log philosophy as remember/recall: memory
      // failures must never break the caller. A transient delete
      // failure means the doc lingers; the cold-export job (Phase
      // 8K+1) catches it on the next run, or it falls out via
      // supermemory's own retention.
      console.error("[memory] supermemory.forget failed:", safeError(err));
    }
  }
}
