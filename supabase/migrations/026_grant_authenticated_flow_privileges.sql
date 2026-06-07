-- ============================================================
-- 026_grant_authenticated_flow_privileges.sql
-- ============================================================
-- ROOT CAUSE FIX — "Flow not found" immediately after creating a flow.
--
-- Creating a flow (POST /api/flows) uses the service_role admin client,
-- so the INSERT succeeded and a real row was written. The editor then
-- loads via GET /api/flows/[id], which runs as the `authenticated` user
-- (RLS applies). On this instance the `authenticated` role had NO
-- table-level DML privileges on the flow tables, so that SELECT failed
-- with:
--
--   42501  permission denied for table flows
--
-- The GET handler ignored the error and returned 404, which the UI
-- rendered as "Flow not found" — even though the row existed and the
-- RLS policy (auth.uid() = user_id) would have allowed it.
--
-- Same class of bug as 020_grant_service_role_privileges.sql, but for
-- the `authenticated` role. Migration 010 created the flow tables and
-- their RLS policies but never issued the base GRANTs that RLS relies on.
--
-- These grants only expose what each table's existing RLS policy already
-- permits, so per-user row isolation is unchanged. All writes still go
-- through service_role; reads/edits run as the owner under RLS.
--
-- No data is modified and no tables are dropped. Idempotent / safe to re-run.
-- ============================================================

-- flows + flow_nodes: RLS policy is FOR ALL (auth.uid() = user_id /
-- ownership-via-flows), so grant the full DML set.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flows      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flow_nodes TO authenticated;

-- flow_runs + flow_run_events: RLS policy is read-only for the owner;
-- the runner writes these via service_role. Grant SELECT only.
GRANT SELECT ON public.flow_runs       TO authenticated;
GRANT SELECT ON public.flow_run_events TO authenticated;
