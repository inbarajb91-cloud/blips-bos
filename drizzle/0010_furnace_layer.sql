-- 0010_furnace_layer.sql
-- Phase 10A — FURNACE schema additions.
--
-- FURNACE takes one STOKER-approved manifestation and produces a visual
-- design brief — 11 fixed sections + extensible addenda, character-bounded,
-- pure-visual (no material weight / garment cut / print technique — those
-- are ENGINE Step 1's job per the May 3 mental-model correction).
--
-- The brief lives as an `agent_outputs` row on the manifestation child
-- signal: agent_name='FURNACE', output_type='brief', content=<brief JSONB>.
-- No new tables. The `revisions` JSONB column from Phase 9 (0006_stoker_layer)
-- carries per-section edit history.
--
-- This migration adds:
--   1. signal_status: FURNACE_REFUSED — the manifestation's status when
--      FURNACE refuses for brand-fit reasons (score < 50).
--   2. agent_outputs.section_approvals JSONB — granular per-section approval
--      state. Could nest inside content but a separate column makes querying
--      easier (e.g. "show all FURNACE outputs where all sections are approved
--      but the brief hasn't promoted to APPROVED — likely a race or bug").

-- ─── signal_status: 1 new value ──────────────────────────────────
-- FURNACE_REFUSED = manifestation's terminal-ish state when FURNACE
--                   refuses to produce a brief because brand-fit score
--                   landed below 50. Founder can force-advance via ORC
--                   (similar to STOKER's add_manifestation pattern) or
--                   dismiss the manifestation entirely.
ALTER TYPE "signal_status" ADD VALUE IF NOT EXISTS 'FURNACE_REFUSED';

-- ─── agent_outputs.section_approvals ─────────────────────────────
-- Per-section approval state for the granular FURNACE approval flow.
-- Founder can approve sections individually as they review the brief;
-- when all required sections are approved, the brief auto-promotes to
-- agent_outputs.status='APPROVED' and fires boiler.ready.
--
-- Shape: Record<sectionName, { approved: boolean, approvedAt: ISO,
--                              approvedBy: uuid }>
--
-- Default empty object; populated lazily as founder approves sections.
-- Sections that are not in this map are treated as not-yet-approved.
--
-- Why a separate column vs nesting inside content:
--   - Easier to query approval state without parsing the whole brief
--   - Avoids race conditions where two simultaneous section approvals
--     could clobber each other if both round-tripped through content
--   - Makes "find briefs where N sections approved" SQL-queryable for
--     future operational dashboards
ALTER TABLE "agent_outputs"
  ADD COLUMN IF NOT EXISTS "section_approvals" JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ─── RLS — already covers agent_outputs by org_id (via signal_id join) ───
-- No new policies needed. Existing policies on agent_outputs scope by the
-- signal's org_id, which covers FURNACE outputs since they live on
-- manifestation child signals.

-- ─── Realtime — agent_outputs is already published ────────────────
-- The Realtime subscription on agent_outputs (set up in Phase 5) covers
-- FURNACE writes automatically. Render page subscribes to changes on the
-- FURNACE output for the active manifestation; updates flow live.
