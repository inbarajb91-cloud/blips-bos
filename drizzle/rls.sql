-- ══════════════════════════════════════════════════════════════════
-- BLIPS BOS — Row-Level Security policies
-- ══════════════════════════════════════════════════════════════════
-- All 14 tables are scoped by org_id to support multi-tenant isolation
-- even though Phase 1-5 is single-org. When DECK portal arrives, these
-- policies are already in place.
--
-- Script is idempotent: DROP IF EXISTS before each CREATE.
-- Re-run safely when policies change.
-- ══════════════════════════════════════════════════════════════════

-- Helper function: current user's org_id from public.users
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM public.users WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated;

-- ─── orgs ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "orgs_select" ON public.orgs;
CREATE POLICY "orgs_select" ON public.orgs
  FOR SELECT TO authenticated
  USING (id = public.current_org_id());

-- ─── users ───────────────────────────────────────────────────────
-- Users see themselves or anyone in their org
DROP POLICY IF EXISTS "users_select" ON public.users;
CREATE POLICY "users_select" ON public.users
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() OR id = auth.uid());

-- Users can update only their own row (profile edits)
DROP POLICY IF EXISTS "users_update_self" ON public.users;
CREATE POLICY "users_update_self" ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ─── batches ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "batches_all" ON public.batches;
CREATE POLICY "batches_all" ON public.batches
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- ─── signals ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "signals_all" ON public.signals;
CREATE POLICY "signals_all" ON public.signals
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- ─── signal_decades (scoped via parent signal) ────────────────────
DROP POLICY IF EXISTS "signal_decades_all" ON public.signal_decades;
CREATE POLICY "signal_decades_all" ON public.signal_decades
  FOR ALL TO authenticated
  USING (
    signal_id IN (SELECT id FROM public.signals WHERE org_id = public.current_org_id())
  )
  WITH CHECK (
    signal_id IN (SELECT id FROM public.signals WHERE org_id = public.current_org_id())
  );

-- ─── bunker_candidates ───────────────────────────────────────────
DROP POLICY IF EXISTS "bunker_candidates_all" ON public.bunker_candidates;
CREATE POLICY "bunker_candidates_all" ON public.bunker_candidates
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- ─── agent_conversations (scoped via parent signal) ───────────────
DROP POLICY IF EXISTS "agent_conversations_all" ON public.agent_conversations;
CREATE POLICY "agent_conversations_all" ON public.agent_conversations
  FOR ALL TO authenticated
  USING (
    signal_id IN (SELECT id FROM public.signals WHERE org_id = public.current_org_id())
  )
  WITH CHECK (
    signal_id IN (SELECT id FROM public.signals WHERE org_id = public.current_org_id())
  );

-- ─── agent_outputs (scoped via parent signal) ─────────────────────
DROP POLICY IF EXISTS "agent_outputs_all" ON public.agent_outputs;
CREATE POLICY "agent_outputs_all" ON public.agent_outputs
  FOR ALL TO authenticated
  USING (
    signal_id IN (SELECT id FROM public.signals WHERE org_id = public.current_org_id())
  )
  WITH CHECK (
    signal_id IN (SELECT id FROM public.signals WHERE org_id = public.current_org_id())
  );

-- ─── agent_logs (read-only from clients; service_role writes) ─────
DROP POLICY IF EXISTS "agent_logs_select" ON public.agent_logs;
CREATE POLICY "agent_logs_select" ON public.agent_logs
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

-- ─── decision_history ────────────────────────────────────────────
DROP POLICY IF EXISTS "decision_history_all" ON public.decision_history;
CREATE POLICY "decision_history_all" ON public.decision_history
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- ─── signal_locks (scoped via parent signal) ──────────────────────
DROP POLICY IF EXISTS "signal_locks_all" ON public.signal_locks;
CREATE POLICY "signal_locks_all" ON public.signal_locks
  FOR ALL TO authenticated
  USING (
    signal_id IN (SELECT id FROM public.signals WHERE org_id = public.current_org_id())
  )
  WITH CHECK (
    signal_id IN (SELECT id FROM public.signals WHERE org_id = public.current_org_id())
  );

-- ─── config_bos ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "config_bos_all" ON public.config_bos;
CREATE POLICY "config_bos_all" ON public.config_bos
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- ─── config_engine_room ──────────────────────────────────────────
DROP POLICY IF EXISTS "config_engine_room_all" ON public.config_engine_room;
CREATE POLICY "config_engine_room_all" ON public.config_engine_room
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- ─── config_agents ───────────────────────────────────────────────
DROP POLICY IF EXISTS "config_agents_all" ON public.config_agents;
CREATE POLICY "config_agents_all" ON public.config_agents
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
