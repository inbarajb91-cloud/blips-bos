-- 0009_stoker_composite_fk_tenant_isolation.sql
-- Phase 9 follow-up — cloud CR pass 3 on PR #8 caught a tenant-isolation
-- gap on the parent_signal_id FK.
--
-- The current FK is parent_signal_id → signals(id), which means a
-- malformed write that bypasses the app's getCurrentUserWithOrg
-- scoping could in principle insert a manifestation child in org A
-- whose parent_signal_id points at a signal in org B. Drizzle's
-- queries always filter by orgId so this can't happen via normal
-- code paths, but the DB layer doesn't enforce it.
--
-- Fix: switch to a composite FK that includes org_id. Requires a
-- UNIQUE constraint on (id, org_id) as the target — Postgres needs
-- the FK target to be backed by a unique index. The existing PK on
-- (id) alone won't satisfy that for a composite FK reference.

-- 1. Add the composite UNIQUE so the FK can target it. Defensive —
--    id is already the PK so this is just an additional unique-by-
--    composite-tuple guarantee.
ALTER TABLE "signals"
  DROP CONSTRAINT IF EXISTS "signals_id_org_id_key";
ALTER TABLE "signals"
  ADD CONSTRAINT "signals_id_org_id_key"
  UNIQUE ("id", "org_id");

-- 2. Drop the single-column FK and replace with composite.
ALTER TABLE "signals"
  DROP CONSTRAINT IF EXISTS "signals_parent_signal_id_fkey";
ALTER TABLE "signals"
  ADD CONSTRAINT "signals_parent_signal_id_fkey"
  FOREIGN KEY ("parent_signal_id", "org_id")
  REFERENCES "signals"("id", "org_id")
  ON DELETE RESTRICT;
