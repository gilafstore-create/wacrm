-- ============================================================
-- Migration 021: Website Auto-Sync Scheduler
-- ============================================================
-- ROOT CAUSE FIX — Auto Sync never actually ran.
--
-- The UI persisted `auto_sync_enabled` and `sync_interval_min` to
-- website_integrations, but NOTHING in the codebase read those columns
-- to trigger a sync. The only code path that ever ran a sync was the
-- manual "Sync Now" button. So Last Sync stayed stale and no background
-- synchronization ever happened.
--
-- This migration adds the scheduling/diagnostics state the new
-- background scheduler needs, plus an atomic "claim" function so that
-- concurrent schedulers (in-process tick + external cron) can never
-- double-run the same integration.
--
-- NOTE on units: the UI offers 5s / 10s / 15s / 30s / 45s / 1m and
-- stores those NUMBERS (5,10,15,30,45,60) in `sync_interval_min`. The
-- column name says "min" for legacy reasons but the value is SECONDS.
-- The scheduler treats it as seconds (floored to a 5s minimum).
--
-- All statements idempotent. Safe to re-run.
-- ============================================================

-- ─── 1. Scheduling + diagnostics columns ─────────────────────
ALTER TABLE public.website_integrations
  ADD COLUMN IF NOT EXISTS next_sync_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sync_attempt_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sync_status          TEXT,      -- 'success' | 'failed'
  ADD COLUMN IF NOT EXISTS last_sync_error           TEXT,
  ADD COLUMN IF NOT EXISTS last_sync_duration_ms     INTEGER,
  ADD COLUMN IF NOT EXISTS consecutive_sync_failures INTEGER NOT NULL DEFAULT 0;

-- Fast lookup of "what is due right now".
CREATE INDEX IF NOT EXISTS idx_wi_due_sync
  ON public.website_integrations (next_sync_at)
  WHERE auto_sync_enabled = true;

-- ─── 2. Atomic claim of due integrations ─────────────────────
-- Selects integrations whose auto-sync is enabled and due, locks them
-- with FOR UPDATE SKIP LOCKED (so two schedulers never grab the same
-- row), immediately reschedules next_sync_at, and returns the claimed
-- rows. The caller then performs the actual HTTP sync per returned row.
--
-- Rescheduling BEFORE the sync runs guarantees the interval is honored
-- even if the sync itself is slow or crashes — the row simply becomes
-- due again after one interval rather than being retried in a tight loop.
CREATE OR REPLACE FUNCTION public.claim_due_website_syncs(p_limit INTEGER DEFAULT 25)
RETURNS SETOF public.website_integrations
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.website_integrations wi
  SET next_sync_at = now() + make_interval(secs => GREATEST(COALESCE(wi.sync_interval_min, 15), 5)),
      last_sync_attempt_at = now()
  WHERE wi.id IN (
    SELECT id
    FROM public.website_integrations
    WHERE auto_sync_enabled = true
      AND status <> 'disabled'
      AND (next_sync_at IS NULL OR next_sync_at <= now())
    ORDER BY next_sync_at NULLS FIRST
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING wi.*;
END;
$$;

-- Only the server-side scheduler (service_role) may claim work.
REVOKE ALL ON FUNCTION public.claim_due_website_syncs(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_due_website_syncs(INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.claim_due_website_syncs(INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_website_syncs(INTEGER) TO service_role;

-- ─── 3. Seed next_sync_at for already-enabled integrations ───
-- Anything currently enabled becomes due immediately on first tick.
UPDATE public.website_integrations
SET next_sync_at = now()
WHERE auto_sync_enabled = true AND next_sync_at IS NULL;

-- ─── 4. Ensure service_role can operate the relevant tables ──
-- (mirrors migration 020; harmless if already granted)
GRANT ALL ON public.website_integrations       TO service_role;
GRANT ALL ON public.website_sync_log           TO service_role;
GRANT ALL ON public.website_webhook_deliveries TO service_role;
