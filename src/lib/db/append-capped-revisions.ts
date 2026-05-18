import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * REVIEW.md F25 (May 18, 2026) — cap `agent_outputs.revisions` at the
 * last 20 entries.
 *
 * Why: revisions is a jsonb array that grew unbounded. Briefs hit 50+
 * revisions before approval in heavy edit cycles. Row gets fat → slow
 * SELECTs, expensive RLS evaluations, painful jsonb scans.
 *
 * Why this cap shape (and not a separate revisions table):
 *   - Inba's call: "A now + B when ENGINE ships" — cap in app today, move
 *     to separate table when ENGINE Step 2 tech-pack revisions add another
 *     dimension of versioning.
 *   - Today: 20 is enough founder-edit history that nobody loses context
 *     mid-iteration; old revisions are visited only by curiosity.
 *   - Tomorrow (ENGINE ships): migrate `revisions` to its own table with
 *     proper indexing + lazy load. This helper goes away.
 *
 * Why this implementation (single SQL atomic, not read-modify-write):
 *   - The `arr - 0` jsonb operator deletes the element at index 0 atomically.
 *   - Invariant: we only ever append one entry at a time. So after append we
 *     are at most ONE over the cap; dropping index 0 brings us back to exactly
 *     the cap. No iteration needed.
 *   - Single SQL statement = no transaction overhead, no lock window for
 *     concurrent edits to race on stale reads.
 *
 * Drop-in replacement at the call site — anywhere that previously did:
 *
 *   revisions: sql`${agentOutputs.revisions} || ${JSON.stringify([entry])}::jsonb`
 *
 * becomes:
 *
 *   revisions: appendCappedRevisions(agentOutputs.revisions, entry)
 *
 * The Drizzle column reference flows through the same column-qualified SQL
 * expansion path the old `sql\`\`` template used.
 */

export const MAX_REVISIONS = 20;

export function appendCappedRevisions<T>(
  column: AnyPgColumn,
  entry: T,
): SQL {
  const json = JSON.stringify([entry]);
  return sql`CASE
    WHEN jsonb_array_length(${column} || ${json}::jsonb) > ${MAX_REVISIONS}
    THEN (${column} || ${json}::jsonb) - 0
    ELSE ${column} || ${json}::jsonb
  END`;
}
