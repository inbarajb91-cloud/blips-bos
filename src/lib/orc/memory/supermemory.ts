import Supermemory from "supermemory";
import { eq } from "drizzle-orm";
import { db, orgs } from "@/db";
import type {
  MemoryBackend,
  MemoryContainer,
  MemoryHit,
  MemoryItem,
  MemoryKind,
  RecallScope,
} from "./types";

/**
 * Per-container, slug-based supermemory tags.
 *
 * Originally we tagged everything as `org-{uuid}` and `org-test-{uuid}`,
 * with the production tag holding BOTH events + knowledge differentiated
 * by metadata.container. That was correct but unreadable in supermemory's
 * dashboard — the UUID gives no signal about what the bucket is, and you
 * couldn't see "what's in events vs knowledge" without filtering by metadata.
 *
 * The new tag layout splits each container into its own tag and uses the
 * org's stable slug:
 *
 *   events    → 'org-{slug}-events'        e.g. org-blips-events
 *   knowledge → 'org-{slug}-knowledge'     e.g. org-blips-knowledge
 *   test      → 'org-test-{slug}'          e.g. org-test-blips
 *
 * Two upsides:
 *   1. The dashboard reads at a glance — you can see exactly which
 *      bucket every doc belongs to without reading metadata.
 *   2. Recall scoping is now enforced at the supermemory containerTag
 *      boundary instead of by post-filtering metadata.container — fewer
 *      hits to wade through, less risk of a misconfigured filter
 *      surfacing the wrong bucket.
 *
 * The org's UUID still uniquely identifies the tenant in Postgres; the
 * slug is the human-facing identifier in supermemory. Both are unique;
 * `orgs.slug` is NOT NULL with a UNIQUE index.
 */
async function buildContainerTag(
  orgId: string,
  container: MemoryContainer,
  slugCache: Map<string, string>,
): Promise<string> {
  const slug = await resolveOrgSlug(orgId, slugCache);
  if (container === "test") return `org-test-${slug}`;
  return `org-${slug}-${container}`;
}

/**
 * Look up an org's slug, with a process-local cache so memory writes
 * don't query Postgres on every call. Slugs don't change after creation,
 * so the cache is effectively eternal for the life of the process.
 *
 * Falls back to the orgId itself if the slug lookup fails — this should
 * never happen in practice (slug is NOT NULL, UNIQUE) but keeps memory
 * writes from breaking on a transient db hiccup. The fallback tag will
 * be different from the slug-based tag, so a recall after a transient
 * failure could miss the doc — accepted as a degradation, not a leak.
 */
async function resolveOrgSlug(
  orgId: string,
  cache: Map<string, string>,
): Promise<string> {
  const cached = cache.get(orgId);
  if (cached) return cached;

  try {
    const [row] = await db
      .select({ slug: orgs.slug })
      .from(orgs)
      .where(eq(orgs.id, orgId))
      .limit(1);

    if (row?.slug) {
      cache.set(orgId, row.slug);
      return row.slug;
    }
  } catch (err) {
    console.error("[memory] failed to resolve org slug, falling back to orgId:", safeError(err));
  }

  // Fallback: use the orgId. Tag still unique per tenant; just less
  // readable. Don't cache — let the next call retry the slug lookup.
  return orgId;
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
 * Supermemory backend — Phase 8K + 8L (slug-based per-container tags).
 *
 * Thin wrapper around the `supermemory` npm package (v4.21+). Translates
 * our MemoryBackend contract into supermemory's actual API:
 *   - WRITE: `client.documents.add({content, containerTag, metadata})` —
 *     supermemory ingests the doc, extracts memories from it, indexes
 *     them. We submit one document per "memory" because each remember()
 *     call carries a single semantic fact.
 *   - READ: `client.search.memories({q, containerTag, ...})` — low-
 *     latency conversational search. Returns extracted memory entries
 *     ranked by similarity. When recall spans multiple containers
 *     (default: events + knowledge), we fan out one search per tag in
 *     parallel and merge results by similarity.
 *
 * Tenant scoping uses supermemory's `containerTag` primitive in a per-
 * container, slug-based layout (see buildContainerTag above). Sub-org
 * scoping (kind / signal / journey / collection) lives in metadata,
 * which we post-filter in JS — fine at our hit volume.
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
  private slugCache = new Map<string, string>();

  constructor(opts: SupermemoryBackendOptions) {
    this.client = new Supermemory({
      apiKey: opts.apiKey,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    });
  }

  async remember(item: MemoryItem): Promise<{ id: string }> {
    try {
      const container: MemoryContainer = item.container ?? "events";
      const containerTag = await buildContainerTag(
        item.orgId,
        container,
        this.slugCache,
      );

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
      // We still set `container` in metadata even though the tag now
      // encodes it — defense-in-depth for any hit that ends up in a
      // mixed-tag query and as a tiebreaker if a caller ever passes
      // multiple containers explicitly.
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
      // to BOTH production tenants (events + knowledge, NOT test).
      // If explicitly 'test' (or includes test), we only hit the
      // isolated test tenant — mixing prod + test in one query isn't
      // supported.
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
      const containers: MemoryContainer[] = isTestSearch
        ? ["test"]
        : requestedContainers;

      // Resolve all tags up front so the per-container fan-out is
      // a single round-trip after the slug cache is warm.
      const tags = await Promise.all(
        containers.map((c) => buildContainerTag(scope.orgId, c, this.slugCache)),
      );

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
      // within supermemory's per-call quotas. Note: tag-based
      // container scoping no longer needs over-fetching for the
      // container filter (each container is its own tag now), but
      // signal/journey/collection/kind still post-filter.
      const wantPostFilter = Boolean(
        scope.signalId || scope.journeyId || scope.collectionId || scope.kind,
      );
      const perTagFetchLimit = wantPostFilter
        ? Math.min(limit * 4, 25)
        : limit;

      // Fan out: one search per tag, in parallel. Each call hits a
      // different supermemory bucket so they don't compete; merging
      // happens in JS by similarity descending.
      const responses = await Promise.all(
        tags.map((containerTag) =>
          this.client.search.memories({
            q: query,
            containerTag,
            limit: perTagFetchLimit,
            // rerank improves quality at +200-300ms latency. Worth it
            // for ORC's recall use case — we only call this when ORC
            // explicitly needs memory, so latency budget is forgiving.
            rerank: true,
          }),
        ),
      );

      const raw = responses.flatMap((r) => r.results ?? []);

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
        if (scope.signalId && m.signalId !== scope.signalId) return false;
        if (scope.journeyId && m.journeyId !== scope.journeyId) return false;
        if (scope.collectionId && m.collectionId !== scope.collectionId) {
          return false;
        }
        return true;
      });

      // Sort by similarity descending across all tags, then cap at
      // `limit`. Without this sort, results are clustered per-tag in
      // the order the parallel responses returned — a high-similarity
      // hit in tag 2 could lose to a low-similarity hit in tag 1.
      filtered.sort(
        (a, b) =>
          (typeof b.similarity === "number" ? b.similarity : 0) -
          (typeof a.similarity === "number" ? a.similarity : 0),
      );

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
