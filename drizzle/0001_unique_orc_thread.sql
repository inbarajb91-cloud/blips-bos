-- ══════════════════════════════════════════════════════════════════
-- Phase 7 CodeRabbit — enforce uniqueness on agent_conversations
-- ══════════════════════════════════════════════════════════════════
-- Finding: getOrCreateOrcConversation does a read-then-insert with
-- only a plain index on signal_id. Two concurrent first-opens can
-- both miss the SELECT and both INSERT, leaving duplicate threads —
-- and the subsequent `.limit(1)` lookup picks nondeterministically.
--
-- Fix: dedup any pre-existing duplicates (keep oldest per pair), then
-- add a UNIQUE INDEX on (signal_id, agent_name). The server action
-- will switch to INSERT ... ON CONFLICT DO UPDATE RETURNING so races
-- resolve to a single canonical row.
-- ══════════════════════════════════════════════════════════════════

-- Dedup: keep the oldest row per (signal_id, agent_name) and delete
-- the rest. ORDER BY created_at, id gives a deterministic tiebreak if
-- two rows share a timestamp (can happen at sub-millisecond scale).
-- `agent_conversations` has no FKs pointing INTO it, so this is safe.
DELETE FROM "agent_conversations"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "signal_id", "agent_name"
        ORDER BY "created_at" ASC, "id" ASC
      ) AS rn
    FROM "agent_conversations"
  ) ranked
  WHERE rn > 1
);
--> statement-breakpoint

-- Enforce uniqueness going forward. IF NOT EXISTS makes the migration
-- idempotent if it's replayed.
CREATE UNIQUE INDEX IF NOT EXISTS "agent_conversations_signal_agent_uidx"
  ON "agent_conversations" ("signal_id", "agent_name");
