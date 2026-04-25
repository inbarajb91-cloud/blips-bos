/**
 * Memory layer — Phase 8K.
 *
 * The contract every memory backend implements. ORC writes facts via
 * `remember()` (decisions, conversation summaries, stage completions,
 * dossiers) and reads them back via `recall()` when answering
 * "have we seen this before?" or "what did we decide on similar
 * signals in RCK?" style questions.
 *
 * Why an interface, not a direct supermemory import:
 *   - We start with supermemory (hosted) for shipping speed.
 *   - If/when we want to swap to pg_vector, Vectorize, or anything
 *     else, only the backend file changes. Every caller stays the
 *     same.
 *   - During tests, we plug in an in-memory mock with the same shape.
 *
 * Failure philosophy: memory is a co-pilot, not a hard dependency.
 * If the backend is unreachable or unconfigured, ORC degrades to its
 * per-signal context and keeps replying. A `NoopMemoryBackend`
 * (see noop.ts) implements the same shape as a no-op, so callers
 * never need to null-check.
 */

/**
 * What kind of fact this memory represents. Drives default scope
 * filtering on retrieval and helps ORC understand what it's reading
 * back ("this is a past decision, not a live conversation").
 *
 * Add new kinds when a new write site appears — e.g. when STOKER
 * lands and we want to remember per-decade manifestation patterns.
 */
export type MemoryKind =
  | "decision" // Approve / dismiss / reset events on a signal
  | "conversation_summary" // Rolling summary written by summarize.ts
  | "stage_completion" // A skill (BUNKER, STOKER, …) finished a stage
  | "signal_dossier" // Compact signal description for cross-signal recall
  | "note"; // Catch-all for explicit "remember this" cases

/**
 * Which storage container this memory belongs in. Three buckets,
 * cleanly separated at the supermemory containerTag level so recall
 * can scope correctly and test data NEVER leaks into production:
 *
 *   - 'events'    → auto-written by hooks (decisions, summaries,
 *                   stage completions). The lived experience of the
 *                   brand. Grows organically as Inba uses BLIPS.
 *   - 'knowledge' → human-curated reference docs (brand strategy,
 *                   decade playbooks, voice guidelines). Written via
 *                   the Settings → Knowledge UI (Phase 8L).
 *   - 'test'      → smoke-test data only. Lives in a SEPARATE
 *                   supermemory containerTag (`org-test-{orgId}`) so
 *                   it's invisible to production recall.
 *
 * Default for production code: 'events'. Default for production
 * recall (when scope.container is undefined): searches BOTH events +
 * knowledge, but never test.
 */
export type MemoryContainer = "events" | "knowledge" | "test";

/**
 * What gets written. orgId is required so multi-tenant scoping is
 * enforced inside the backend (supermemory uses containerTags;
 * pg_vector would use a column filter — same intent, different
 * mechanism).
 */
export interface MemoryItem {
  orgId: string;
  /** Which container to write to. Default: 'events'. Use 'knowledge'
   *  for curated reference uploads, 'test' for smoke tests. */
  container?: MemoryContainer;
  kind: MemoryKind;
  /** The text of the memory. Keep under ~600 tokens — supermemory
   *  charges by stored token, and short memories retrieve sharper. */
  content: string;
  /** Optional foreign keys for scoped recall and for the cold export
   *  to reattach memories to the relational graph. */
  signalId?: string;
  journeyId?: string;
  collectionId?: string;
  /** Anything structured worth keeping (decade, stage, decision
   *  outcome, etc.). Backend stores it verbatim. */
  metadata?: Record<string, unknown>;
}

/**
 * Scope hints passed to `recall()`. orgId is required (always tenant-
 * scoped); the rest narrow the search.
 */
export interface RecallScope {
  orgId: string;
  /** Restrict to a single signal. Useful for "what did we decide on
   *  THIS signal earlier?" but rarely set — the live conversation
   *  already carries that. */
  signalId?: string;
  journeyId?: string;
  collectionId?: string;
  /** Restrict to one or more memory kinds. */
  kind?: MemoryKind | MemoryKind[];
  /** Restrict to one or more containers. Default: searches 'events' +
   *  'knowledge' (production data only). Pass 'test' explicitly to
   *  search the isolated test container. */
  container?: MemoryContainer | MemoryContainer[];
  /** Default 5. Cap is up to the backend (supermemory: 50). */
  limit?: number;
}

/**
 * Single retrieval result. Score is a similarity in [0, 1]; higher is
 * closer. Backends with a different distance metric (e.g. cosine
 * distance) normalize before returning.
 */
export interface MemoryHit {
  id: string;
  content: string;
  kind: MemoryKind;
  score: number;
  signalId?: string;
  journeyId?: string;
  collectionId?: string;
  metadata?: Record<string, unknown>;
  /** ISO 8601. */
  createdAt: string;
}

/**
 * The contract. Two methods, no surprises.
 *
 * Backends should:
 *   - swallow transient network failures and return `{id: ''}` /
 *     `[]` rather than throwing — memory should never break ORC's
 *     reply path.
 *   - log failures so we can monitor real problems.
 */
export interface MemoryBackend {
  /** Persist a memory. Returns the backend's id for the new row.
   *  On failure, returns an empty id and logs internally. */
  remember(item: MemoryItem): Promise<{ id: string }>;

  /** Semantic search. Returns up to scope.limit hits (default 5),
   *  ordered by similarity descending. On failure, returns []. */
  recall(query: string, scope: RecallScope): Promise<MemoryHit[]>;
}
