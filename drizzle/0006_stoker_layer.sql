-- 0006_stoker_layer.sql
-- Phase 9A — STOKER schema additions.
--
-- STOKER takes a BUNKER-approved signal and produces 1-3 manifestation
-- child signals (one per resonant decade). Per Model 3 (locked April 29
-- in agents/STOKER.md), manifestations live in the same `signals` table
-- as raw signals — distinguished by parent_signal_id + manifestation_decade
-- columns + a new signal_source enum value. No separate manifestations
-- table; everything we ever build for signals applies to manifestations
-- automatically.
--
-- Also bumps signal_status with two new values for the parent's
-- post-STOKER lifecycle (FANNED_OUT / STOKER_REFUSED) and adds
-- agent_outputs.revisions for STOKER edit history.

-- ─── signal_status: 2 new values ─────────────────────────────────
-- FANNED_OUT   = parent terminal state after STOKER produces children.
--                Parent's job is done; the children take it from here.
-- STOKER_REFUSED = parent's terminal state when STOKER finds no decade
--                with resonance score >= 50 and refuses to manifest.
--                Founder can still force-add a child via ORC's
--                add_manifestation tool — that creates a child in
--                IN_STOKER status without changing the parent's
--                STOKER_REFUSED status.
ALTER TYPE "signal_status" ADD VALUE IF NOT EXISTS 'FANNED_OUT';
ALTER TYPE "signal_status" ADD VALUE IF NOT EXISTS 'STOKER_REFUSED';

-- ─── signal_source: 1 new value ──────────────────────────────────
-- Distinguishes STOKER-produced children from BUNKER-extracted raw
-- signals. Used for filtering, analytics, and as a defense-in-depth
-- check (a signal with source='stoker_manifestation' must have
-- parent_signal_id set; raw signals never have this source).
ALTER TYPE "signal_source" ADD VALUE IF NOT EXISTS 'stoker_manifestation';

-- ─── signals: parent_signal_id + manifestation_decade ────────────
-- parent_signal_id: FK back to the parent (raw) signal. NULL for raw
--                   signals; SET on manifestation children.
--                   ON DELETE SET NULL — if a parent is hard-deleted
--                   (rare), children survive as orphan manifestations
--                   the founder can still review. Cascade-delete
--                   would silently lose work.
-- manifestation_decade: which decade this manifestation is for.
--                   Reuses the existing `decade_lens` enum
--                   (RCK / RCL / RCD).
ALTER TABLE "signals"
  ADD COLUMN IF NOT EXISTS "parent_signal_id" UUID
    REFERENCES "signals"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "manifestation_decade" "decade_lens";

-- Both columns must be NULL together (raw signal) or both SET together
-- (manifestation child). A signal with parent_signal_id but no decade,
-- or vice versa, is malformed.
ALTER TABLE "signals"
  DROP CONSTRAINT IF EXISTS "signals_manifestation_consistency";
ALTER TABLE "signals"
  ADD CONSTRAINT "signals_manifestation_consistency" CHECK (
    (parent_signal_id IS NULL AND manifestation_decade IS NULL)
    OR
    (parent_signal_id IS NOT NULL AND manifestation_decade IS NOT NULL)
  );

-- Index for the Bridge nested-children query path. Lets us pull all
-- manifestations of a parent in one indexed lookup.
CREATE INDEX IF NOT EXISTS "signals_parent_signal_idx"
  ON "signals"("parent_signal_id")
  WHERE parent_signal_id IS NOT NULL;

-- ─── agent_outputs.revisions ─────────────────────────────────────
-- STOKER edits go through the per-card edit-in-place flow. Each edit
-- is a new entry in this JSONB array on the corresponding agent_outputs
-- row, capturing the field changes + editor + timestamp + optional
-- reason. Default empty array; populated lazily on first edit.
--
-- Shape (per entry):
--   { ts: ISO-8601, fields: { framingHook?, tensionAxis?, ... },
--     editor: { authId, kind: 'founder'|'orc' }, reason?: string }
ALTER TABLE "agent_outputs"
  ADD COLUMN IF NOT EXISTS "revisions" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ─── RLS — already covers signals + agent_outputs by org_id ───────
-- Manifestation children inherit org_id from the parent at creation
-- (in the STOKER skill's child-creation logic), so existing org_id-
-- scoped policies cover them without modification.
