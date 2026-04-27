-- ══════════════════════════════════════════════════════════════════
-- Phase 8A — Journey architecture
-- ══════════════════════════════════════════════════════════════════
-- Every signal now has one or more journeys over its lifetime. A
-- journey is the narrative of what happened to the signal for one
-- attempt through the pipeline — approvals, dismissals, stage
-- outputs, ORC conversations. Reset-from-stage X = archive current
-- journey, spawn a new one where stages before X inherit from the
-- prior journey and stages from X onwards re-run.
--
-- Scope: adds `journeys` table + `journey_id` FKs across the five
-- tables that describe "what happened inside the pipeline" —
-- agent_outputs, agent_conversations, signal_decades, agent_logs,
-- decision_history. Signal locks + collections + candidates stay
-- journey-unaware (they're pre-signal or cross-signal concerns).
--
-- Backfill: at current scale, 12 signals → 12 Journey 1 rows + FKs
-- populated on 4 existing ORC conversations. All other tables are
-- empty or have NULL signal_id (cron/pre-signal). Zero risk.
--
-- Phase 7 invariant update: the unique index on agent_conversations
-- was (signal_id, agent_name). With journeys, ORC conversations are
-- per-journey (each attempt gets its own coherent thread). Swapped
-- to (journey_id, agent_name). The old index is dropped after
-- backfill so the one-thread-per-agent-per-journey invariant
-- replaces the one-thread-per-agent-per-signal invariant cleanly.
-- ══════════════════════════════════════════════════════════════════

-- 1. journey_status enum
CREATE TYPE "journey_status" AS ENUM ('active', 'archived', 'dismissed');

-- 2. journeys table
CREATE TABLE "journeys" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "signal_id" UUID NOT NULL REFERENCES "signals"("id") ON DELETE CASCADE,
  "sequence_number" INTEGER NOT NULL,
  "status" "journey_status" NOT NULL DEFAULT 'active',
  "previous_journey_id" UUID REFERENCES "journeys"("id") ON DELETE SET NULL,
  "reset_from_stage" "agent_name",
  "reset_reason" TEXT,
  "started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "ended_at" TIMESTAMP WITH TIME ZONE,
  "ended_reason" TEXT,
  "created_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "journeys_signal_sequence_uq" UNIQUE ("signal_id", "sequence_number")
);

-- One active journey per signal — partial unique index. The partial
-- WHERE clause is the key: it lets N archived journeys coexist but
-- only ever one "active" row. Swapping active journey on reset is
-- a two-step transaction (archive old → insert new).
CREATE UNIQUE INDEX "journeys_signal_active_uidx"
  ON "journeys" ("signal_id")
  WHERE "status" = 'active';

CREATE INDEX "journeys_signal_idx" ON "journeys" ("signal_id");
CREATE INDEX "journeys_previous_idx" ON "journeys" ("previous_journey_id");

-- 3. Add nullable journey_id columns (tighten to NOT NULL after backfill)
ALTER TABLE "agent_outputs"
  ADD COLUMN "journey_id" UUID REFERENCES "journeys"("id") ON DELETE CASCADE;

ALTER TABLE "agent_conversations"
  ADD COLUMN "journey_id" UUID REFERENCES "journeys"("id") ON DELETE CASCADE;

ALTER TABLE "signal_decades"
  ADD COLUMN "journey_id" UUID REFERENCES "journeys"("id") ON DELETE CASCADE;

-- agent_logs.journey_id stays nullable forever — pre-signal BUNKER
-- runs and cron logs have no associated journey.
ALTER TABLE "agent_logs"
  ADD COLUMN "journey_id" UUID REFERENCES "journeys"("id") ON DELETE SET NULL;

ALTER TABLE "decision_history"
  ADD COLUMN "journey_id" UUID REFERENCES "journeys"("id") ON DELETE CASCADE;

-- 4. Backfill: one Journey 1 per existing signal. status defaults to
-- 'active' and started_at defaults to NOW() via the column defaults,
-- but we override started_at to the signal's created_at so the
-- journey timeline reads correctly from day one.
INSERT INTO "journeys" ("signal_id", "sequence_number", "status", "started_at")
SELECT "id", 1, 'active', "created_at"
FROM "signals";

-- 5. Backfill journey_id on existing rows. Each row's signal_id
-- maps to exactly one Journey 1 (partial unique index guarantees).
UPDATE "agent_outputs" ao
SET "journey_id" = j."id"
FROM "journeys" j
WHERE ao."signal_id" = j."signal_id" AND j."sequence_number" = 1;

UPDATE "agent_conversations" ac
SET "journey_id" = j."id"
FROM "journeys" j
WHERE ac."signal_id" = j."signal_id" AND j."sequence_number" = 1;

UPDATE "signal_decades" sd
SET "journey_id" = j."id"
FROM "journeys" j
WHERE sd."signal_id" = j."signal_id" AND j."sequence_number" = 1;

-- agent_logs: only update rows that HAVE a signal_id. NULL-signal
-- rows (cron / pre-signal BUNKER) legitimately have NULL journey_id.
UPDATE "agent_logs" al
SET "journey_id" = j."id"
FROM "journeys" j
WHERE al."signal_id" = j."signal_id" AND j."sequence_number" = 1;

UPDATE "decision_history" dh
SET "journey_id" = j."id"
FROM "journeys" j
WHERE dh."signal_id" = j."signal_id" AND j."sequence_number" = 1;

-- 6. Lock NOT NULL where appropriate. agent_logs.journey_id stays
-- nullable per the comment above.
ALTER TABLE "agent_outputs" ALTER COLUMN "journey_id" SET NOT NULL;
ALTER TABLE "agent_conversations" ALTER COLUMN "journey_id" SET NOT NULL;
ALTER TABLE "signal_decades" ALTER COLUMN "journey_id" SET NOT NULL;
ALTER TABLE "decision_history" ALTER COLUMN "journey_id" SET NOT NULL;

-- 7. Swap the ORC conversation uniqueness from (signal_id, agent_name)
-- to (journey_id, agent_name). Old invariant: one ORC thread per
-- signal. New invariant: one ORC thread per journey (each attempt
-- gets its own coherent conversation; archived journeys keep their
-- thread readable in the history view).
DROP INDEX "agent_conversations_signal_agent_uidx";
CREATE UNIQUE INDEX "agent_conversations_journey_agent_uidx"
  ON "agent_conversations" ("journey_id", "agent_name");

-- 8. Swap the signal_decades uniqueness from (signal_id, decade_lens)
-- to (signal_id, journey_id, decade_lens). Each journey gets its
-- own set of 3 decade manifestations for the signal — resetting
-- STOKER creates a fresh set on the new journey without colliding
-- with the archived journey's rows.
DROP INDEX "signal_decades_signal_lens_uq";
CREATE UNIQUE INDEX "signal_decades_signal_journey_lens_uq"
  ON "signal_decades" ("signal_id", "journey_id", "decade_lens");

-- 9. Indexes on new FKs for scoped queries
CREATE INDEX "agent_outputs_journey_idx" ON "agent_outputs" ("journey_id");
CREATE INDEX "agent_conversations_journey_idx" ON "agent_conversations" ("journey_id");
CREATE INDEX "signal_decades_journey_idx" ON "signal_decades" ("journey_id");
CREATE INDEX "agent_logs_journey_idx" ON "agent_logs" ("journey_id");
CREATE INDEX "decision_history_journey_idx" ON "decision_history" ("journey_id");
