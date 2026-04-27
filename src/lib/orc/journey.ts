import { and, eq } from "drizzle-orm";
import { db, journeys } from "@/db";

/**
 * Accepts either the top-level `db` instance or a `tx` handle from
 * `db.transaction(async (tx) => ...)`. Drizzle's transaction callback
 * receives a `PgTransaction` type that's structurally similar to the
 * top-level `PostgresJsDatabase` for all query-builder methods
 * (`.insert()`, `.select()`, etc.) but lacks a few connection-pool
 * fields, so we union them here.
 */
type Db = typeof db;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTx = Db | Tx;

/**
 * Journey primitives — Phase 8.
 *
 * Every signal has one or more journeys over its lifetime. A journey is
 * the narrative of one attempt at driving the signal through the
 * pipeline — approvals, dismissals, stage outputs, ORC conversations.
 * When a user resets from stage X, the current journey archives and a
 * new one starts (stages before X inherit; stages from X onwards
 * re-run through human gates).
 *
 * This module is the single source of truth for:
 *   - Creating the initial journey when a signal is born
 *   - Looking up the active journey for a signal
 *   - (Phase 9+) Archiving and rebranching on reset
 *
 * Schema invariant (enforced by partial unique index
 * `journeys_signal_active_uidx`): at most one journey per signal has
 * status='active' at any time. The rest are 'archived' (prior
 * attempts) or 'dismissed' (abandoned resets).
 */

export interface Journey {
  id: string;
  signalId: string;
  sequenceNumber: number;
  status: "active" | "archived" | "dismissed";
  previousJourneyId: string | null;
  resetFromStage: string | null;
  resetReason: string | null;
  startedAt: Date;
  endedAt: Date | null;
  endedReason: string | null;
  createdBy: string | null;
}

/**
 * Create Journey 1 for a newly-created signal. Called from
 * `approveCandidate` and any future signal-creation path. The initial
 * journey has no `reset_from_stage` and no `previous_journey_id` —
 * both nullable columns left as NULL — because no reset happened; it's
 * the first attempt.
 *
 * Idempotent in practice: if called twice for the same signal the
 * second call violates `journeys_signal_sequence_uq` (signal_id,
 * sequence_number=1) and we surface the conflict. Callers should wrap
 * this inside the same transaction as the signal INSERT so both
 * succeed or both roll back.
 */
export async function createInitialJourney(
  opts: { signalId: string; createdBy: string | null },
  tx: DbOrTx = db,
): Promise<Journey> {
  const [created] = await tx
    .insert(journeys)
    .values({
      signalId: opts.signalId,
      sequenceNumber: 1,
      status: "active",
      createdBy: opts.createdBy,
      // previousJourneyId, resetFromStage, resetReason, endedAt,
      // endedReason all default to NULL — this is the root journey.
    })
    .returning();
  return created as Journey;
}

/**
 * Fetch the currently-active journey for a signal. Throws if no
 * active journey exists — every signal should have one, and a missing
 * active journey indicates a data integrity issue (signal created
 * without its Journey 1, or every journey was dismissed without a
 * replacement).
 *
 * Use this at the boundary of every downstream write path (agent_outputs
 * insert, agent_conversations insert, decision_history insert) so the
 * journey_id FK is always populated on the correct journey.
 */
export async function getActiveJourney(
  signalId: string,
  tx: DbOrTx = db,
): Promise<Journey> {
  const [row] = await tx
    .select()
    .from(journeys)
    .where(and(eq(journeys.signalId, signalId), eq(journeys.status, "active")))
    .limit(1);
  if (!row) {
    throw new Error(
      `No active journey for signal ${signalId}. Signals must have exactly one active journey — a missing one indicates a data integrity issue.`,
    );
  }
  return row as Journey;
}

/**
 * Non-throwing variant. Returns null when no active journey exists.
 * Useful for read paths (workspace render) that want to degrade
 * gracefully rather than error out on data oddities.
 */
export async function findActiveJourney(
  signalId: string,
  tx: DbOrTx = db,
): Promise<Journey | null> {
  const [row] = await tx
    .select()
    .from(journeys)
    .where(and(eq(journeys.signalId, signalId), eq(journeys.status, "active")))
    .limit(1);
  return (row as Journey | undefined) ?? null;
}
