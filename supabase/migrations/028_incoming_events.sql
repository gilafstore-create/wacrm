-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 028: Incoming Events — Event Inspector forensic table
-- Stores every event received from any website integration with full detail.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Main table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.incoming_events (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  integration_id          uuid        REFERENCES public.website_integrations(id) ON DELETE SET NULL,

  -- Event identity
  event_id                text        NOT NULL DEFAULT gen_random_uuid()::text,
  event_name              text        NOT NULL,
  source_ip               text,
  user_agent              text,

  -- Processing outcome
  status                  text        NOT NULL DEFAULT 'processing'
                          CHECK (status IN ('processing','processed','ignored','partial','failed')),
  processing_duration_ms  integer,
  handler_used            text,
  error_message           text,
  error_type              text,       -- 'auth_error' | 'validation_error' | 'db_error' | 'unknown_event' | etc.

  -- Created records (filled by handler)
  result_contact_id       uuid        REFERENCES public.contacts(id) ON DELETE SET NULL,
  result_order_ref        text,       -- external order ID string
  result_pipeline_id      uuid,
  result_conversation_id  uuid,
  result_broadcast_id     uuid,

  -- Security
  signature_status        text        DEFAULT 'unknown'
                          CHECK (signature_status IN ('valid','bypassed','missing','invalid','unknown')),
  api_key_prefix          text,

  -- Payloads (JSONB for querying)
  payload                 jsonb,      -- full raw event payload
  processing_steps        jsonb,      -- array of { time, step, detail, ok }
  debug_info              jsonb,      -- unknown event: handlers_checked, recommendation

  -- Retry tracking
  retry_count             integer     NOT NULL DEFAULT 0,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_incoming_events_user_id     ON public.incoming_events (user_id);
CREATE INDEX IF NOT EXISTS idx_incoming_events_intg_id     ON public.incoming_events (integration_id);
CREATE INDEX IF NOT EXISTS idx_incoming_events_event_name  ON public.incoming_events (event_name);
CREATE INDEX IF NOT EXISTS idx_incoming_events_status      ON public.incoming_events (status);
CREATE INDEX IF NOT EXISTS idx_incoming_events_created_at  ON public.incoming_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incoming_events_source_ip   ON public.incoming_events (source_ip);
-- GIN index on payload for JSON search
CREATE INDEX IF NOT EXISTS idx_incoming_events_payload_gin ON public.incoming_events USING gin(payload);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.incoming_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own incoming events" ON public.incoming_events;
CREATE POLICY "Users can view own incoming events"
  ON public.incoming_events FOR SELECT
  USING (auth.uid() = user_id);

-- Service role inserts/updates (webhook handler uses service role)
DROP POLICY IF EXISTS "Service role manages incoming events" ON public.incoming_events;
CREATE POLICY "Service role manages incoming events"
  ON public.incoming_events FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── Trigger: auto-update updated_at ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_incoming_events_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_incoming_events_updated_at ON public.incoming_events;
CREATE TRIGGER trg_incoming_events_updated_at
  BEFORE UPDATE ON public.incoming_events
  FOR EACH ROW EXECUTE FUNCTION public.set_incoming_events_updated_at();

-- ── Grant service role full access ───────────────────────────────────────────
GRANT ALL ON public.incoming_events TO service_role;
GRANT SELECT ON public.incoming_events TO authenticated;

-- ── Cleanup: auto-delete events older than 90 days (keep table lean) ─────────
-- This is a lightweight approach; for production use pg_cron.
-- The application layer prunes on read if needed.
COMMENT ON TABLE public.incoming_events IS
  'Forensic log of every incoming webhook event from website integrations. '
  'Populated by the WACRM webhook route. Events older than 90 days may be pruned.';
