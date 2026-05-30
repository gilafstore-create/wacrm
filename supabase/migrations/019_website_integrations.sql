-- ============================================================
-- Migration 019: Website Integration Module
-- ============================================================
-- Universal website ↔ WACRM connection management.
-- All statements idempotent. Safe to re-run.
-- ============================================================

-- ─── 1. website_integrations ─────────────────────────────────
-- One record per connected website. Encrypted keys stored here.
CREATE TABLE IF NOT EXISTS public.website_integrations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Website identity
  website_name    TEXT        NOT NULL,
  website_url     TEXT        NOT NULL,
  platform        TEXT        NOT NULL DEFAULT 'custom', -- 'woocommerce'|'shopify'|'magento'|'opencart'|'custom'

  -- Auth credentials (stored encrypted — never expose raw)
  website_api_key TEXT        NOT NULL,  -- key GilafStore sends to WACRM
  website_secret  TEXT        NOT NULL,  -- HMAC secret for signature validation

  -- Webhook config
  webhook_url     TEXT,                  -- URL WACRM posts events TO
  webhook_events  JSONB       NOT NULL DEFAULT '["order.placed","order.shipped","otp.requested"]'::jsonb,
  webhook_secret  TEXT,                  -- secret WACRM uses to sign outbound calls

  -- Connection token (one-time setup)
  connection_token TEXT       UNIQUE,    -- gs_connect_xxx shown to store owner
  token_used_at   TIMESTAMPTZ,

  -- Status & health
  status          TEXT        NOT NULL DEFAULT 'pending', -- 'pending'|'active'|'warning'|'error'|'disabled'
  health_score    SMALLINT    NOT NULL DEFAULT 0,         -- 0-100
  last_sync_at    TIMESTAMPTZ,
  last_error      TEXT,
  last_error_at   TIMESTAMPTZ,

  -- Discovery
  discovered_version  TEXT,
  discovered_endpoints JSONB,
  last_discovery_at   TIMESTAMPTZ,

  -- Auto-sync config
  auto_sync_enabled   BOOLEAN NOT NULL DEFAULT false,
  sync_interval_min   INTEGER NOT NULL DEFAULT 15, -- 1|5|15|30

  -- Heartbeat / keep-alive
  heartbeat_enabled   BOOLEAN NOT NULL DEFAULT true,
  last_heartbeat_at   TIMESTAMPTZ,
  heartbeat_latency_ms INTEGER,

  -- Counts
  total_webhooks_sent     INTEGER NOT NULL DEFAULT 0,
  total_webhooks_failed   INTEGER NOT NULL DEFAULT 0,
  total_synced_contacts   INTEGER NOT NULL DEFAULT 0,
  total_synced_orders     INTEGER NOT NULL DEFAULT 0,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wi_user_id  ON public.website_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_wi_status   ON public.website_integrations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_wi_token    ON public.website_integrations(connection_token);

ALTER TABLE public.website_integrations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='website_integrations' AND policyname='Users manage own integrations') THEN
    CREATE POLICY "Users manage own integrations"
      ON public.website_integrations FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ─── 2. website_webhook_deliveries ───────────────────────────
-- Full audit trail of every outbound webhook WACRM sends to a website.
CREATE TABLE IF NOT EXISTS public.website_webhook_deliveries (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id  UUID        NOT NULL REFERENCES public.website_integrations(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  event_type      TEXT        NOT NULL,  -- 'order.shipped', 'otp.sent', etc.
  payload         JSONB,
  endpoint        TEXT,                  -- URL called

  -- Response
  http_status     INTEGER,
  response_body   TEXT,
  duration_ms     INTEGER,

  -- Retry state
  attempt         SMALLINT    NOT NULL DEFAULT 1,
  max_attempts    SMALLINT    NOT NULL DEFAULT 3,
  next_retry_at   TIMESTAMPTZ,
  status          TEXT        NOT NULL DEFAULT 'pending', -- 'pending'|'delivered'|'failed'|'retrying'

  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wwd_integration ON public.website_webhook_deliveries(integration_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wwd_status      ON public.website_webhook_deliveries(status, next_retry_at);

ALTER TABLE public.website_webhook_deliveries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='website_webhook_deliveries' AND policyname='Users see own deliveries') THEN
    CREATE POLICY "Users see own deliveries"
      ON public.website_webhook_deliveries FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- ─── 3. website_sync_log ─────────────────────────────────────
-- Record of every sync operation (manual or automatic).
CREATE TABLE IF NOT EXISTS public.website_sync_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id  UUID        NOT NULL REFERENCES public.website_integrations(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sync_type       TEXT        NOT NULL DEFAULT 'manual', -- 'manual'|'auto'|'initial'
  entity_type     TEXT        NOT NULL DEFAULT 'contacts', -- 'contacts'|'orders'|'products'|'all'
  records_synced  INTEGER     NOT NULL DEFAULT 0,
  records_failed  INTEGER     NOT NULL DEFAULT 0,
  duration_ms     INTEGER,
  status          TEXT        NOT NULL DEFAULT 'running', -- 'running'|'completed'|'failed'
  error_message   TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wsl_integration ON public.website_sync_log(integration_id, started_at DESC);
ALTER TABLE public.website_sync_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='website_sync_log' AND policyname='Users see own sync log') THEN
    CREATE POLICY "Users see own sync log"
      ON public.website_sync_log FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;
