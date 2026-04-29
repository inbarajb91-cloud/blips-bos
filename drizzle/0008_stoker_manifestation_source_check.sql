-- 0008_stoker_manifestation_source_check.sql
-- Phase 9 follow-up — cloud CR pass on PR #8 caught a missing schema
-- invariant.
--
-- 0006 added the signals_manifestation_consistency CHECK to enforce
-- "(parent_signal_id IS NULL AND manifestation_decade IS NULL) OR
--  (parent_signal_id IS NOT NULL AND manifestation_decade IS NOT NULL)"
--
-- but it doesn't tie either column to the source value. A row could
-- still drift out of sync — e.g., a manifestation child somehow
-- inserted with source = 'rss' or some BUNKER source — without the DB
-- catching it. STOKER's Inngest fan-out always sets source =
-- 'stoker_manifestation' on children and BUNKER's flows never use that
-- source on raw signals, so this CHECK just hardens the invariant the
-- application code already maintains.
--
-- Bidirectional check:
--   manifestation_decade IS NOT NULL  ⇔  source = 'stoker_manifestation'

ALTER TABLE "signals"
  DROP CONSTRAINT IF EXISTS "signals_manifestation_source_consistency";

ALTER TABLE "signals"
  ADD CONSTRAINT "signals_manifestation_source_consistency" CHECK (
    (manifestation_decade IS NOT NULL AND source = 'stoker_manifestation')
    OR
    (manifestation_decade IS NULL AND source <> 'stoker_manifestation')
  );
