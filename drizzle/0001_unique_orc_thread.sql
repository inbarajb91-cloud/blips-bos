-- ══════════════════════════════════════════════════════════════════
-- Phase 7 CodeRabbit — enforce uniqueness on agent_conversations
-- ══════════════════════════════════════════════════════════════════
-- Finding: getOrCreateOrcConversation does a read-then-insert with
-- only a plain index on signal_id. Two concurrent first-opens can
-- both miss the SELECT and both INSERT, leaving duplicate threads —
-- and the subsequent `.limit(1)` lookup picks nondeterministically.
--
-- Fix: add a UNIQUE INDEX on (signal_id, agent_name). Before we
-- create the index, any pre-existing duplicates must be consolidated.
--
-- Safety (CodeRabbit round 2 — Critical): the first draft deleted
-- non-canonical rows outright. That's unsafe — if duplicate threads
-- diverged (each accumulating its own messages), a raw DELETE would
-- permanently drop user-visible conversation history. This version
-- MERGES each group's messages into the canonical (oldest) row
-- FIRST, then deletes the extras. Duplicate seed messages are
-- accepted as harmless noise; silent data loss isn't.
--
-- At current BLIPS scale the duplicates at migration time are
-- expected to be rare or absent — the pre-Phase-7 race window was
-- narrow. Merge logic is defense-in-depth; if the migration were
-- ever replayed against a state that accumulated duplicates, it
-- must still be safe.
-- ══════════════════════════════════════════════════════════════════

BEGIN;
--> statement-breakpoint

-- Step 1: For each (signal_id, agent_name) group that has duplicates,
-- build a merged messages array — every message from every row in
-- the group, ordered by its own `ts` field so the thread reads
-- chronologically regardless of which duplicate it came from. Write
-- the merged array back onto the canonical (oldest) row.
WITH dupe_groups AS (
  SELECT "signal_id", "agent_name"
  FROM "agent_conversations"
  GROUP BY "signal_id", "agent_name"
  HAVING COUNT(*) > 1
),
all_messages AS (
  SELECT
    ac."signal_id",
    ac."agent_name",
    msg
  FROM "agent_conversations" ac
  JOIN dupe_groups dg
    ON dg."signal_id" = ac."signal_id"
   AND dg."agent_name" = ac."agent_name"
  CROSS JOIN LATERAL jsonb_array_elements(ac."messages") AS msg
),
merged AS (
  SELECT
    "signal_id",
    "agent_name",
    jsonb_agg(msg ORDER BY msg->>'ts') AS merged_messages
  FROM all_messages
  GROUP BY "signal_id", "agent_name"
),
canonical AS (
  SELECT DISTINCT ON ("signal_id", "agent_name")
    "id", "signal_id", "agent_name"
  FROM "agent_conversations"
  WHERE ("signal_id", "agent_name") IN (
    SELECT "signal_id", "agent_name" FROM dupe_groups
  )
  ORDER BY "signal_id", "agent_name", "created_at" ASC, "id" ASC
)
UPDATE "agent_conversations" ac
SET "messages" = m."merged_messages",
    "updated_at" = NOW()
FROM merged m
JOIN canonical c
  ON c."signal_id" = m."signal_id"
 AND c."agent_name" = m."agent_name"
WHERE ac."id" = c."id";
--> statement-breakpoint

-- Step 2: Delete the non-canonical rows. At this point their
-- messages have been merged into the canonical row, so nothing is
-- lost. Deterministic tiebreak (created_at ASC, id ASC) keeps the
-- oldest row — the one the UPDATE targeted.
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

-- Step 3: Enforce uniqueness going forward. IF NOT EXISTS keeps this
-- migration idempotent if it's replayed.
CREATE UNIQUE INDEX IF NOT EXISTS "agent_conversations_signal_agent_uidx"
  ON "agent_conversations" ("signal_id", "agent_name");
--> statement-breakpoint

COMMIT;
