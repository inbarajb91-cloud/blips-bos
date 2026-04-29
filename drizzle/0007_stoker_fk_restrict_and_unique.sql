-- 0007_stoker_fk_restrict_and_unique.sql
-- Phase 9 follow-up — two corrections caught by CodeRabbit on PR #8:
--
-- 1. Critical: signals.parent_signal_id FK was ON DELETE SET NULL,
--    which violates signals_manifestation_consistency CHECK on parent
--    deletion. When a parent is deleted, parent_signal_id is set NULL
--    but manifestation_decade stays SET — and the CHECK demands "both
--    null OR both set". The DELETE then fails with a constraint
--    violation. Switch to ON DELETE RESTRICT (same pattern as Phase 8L
--    knowledge_documents author FKs): parent deletion fails loudly
--    until the founder explicitly handles the manifestation children
--    first. Forces deliberate cleanup, never silent-loses audit trail.
--
-- 2. Major: a parent should not be allowed to have two manifestations
--    for the same decade. STOKER itself produces one per decade per
--    run, but ORC's add_manifestation tool (Phase 9G) could insert a
--    duplicate if the founder asks ORC to add a decade that already
--    exists. Enforce at the schema level via a partial UNIQUE INDEX.

-- Drop and re-add FK with RESTRICT semantics. Postgres auto-named the
-- existing constraint signals_parent_signal_id_fkey when the column
-- was added in 0006 (no explicit constraint name). We re-add with the
-- same auto-generated name so future Drizzle introspection matches
-- production naming.
ALTER TABLE "signals"
  DROP CONSTRAINT IF EXISTS "signals_parent_signal_id_fkey";
ALTER TABLE "signals"
  ADD CONSTRAINT "signals_parent_signal_id_fkey"
  FOREIGN KEY ("parent_signal_id") REFERENCES "signals"("id")
  ON DELETE RESTRICT;

-- One manifestation per (parent, decade) pair. Partial so raw signals
-- (parent_signal_id NULL) don't collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS "signals_parent_decade_unique_idx"
  ON "signals"("parent_signal_id", "manifestation_decade")
  WHERE parent_signal_id IS NOT NULL;
