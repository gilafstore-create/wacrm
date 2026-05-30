-- ============================================================
-- Migration 014: GilafStore Integration Tables
-- ============================================================
-- Creates the tables required for the GilafStore ↔ WACRM
-- integration layer. All statements are idempotent (IF NOT EXISTS)
-- so re-running is safe.
--
-- Tables:
--   1. integration_keys         — API key pairs issued to GilafStore PHP
--   2. integration_webhook_logs — Audit log of inbound GilafStore webhooks
--   3. integration_message_logs — Log of outbound WhatsApp messages sent via integration
-- ============================================================

-- ─── 1. integration_keys ─────────────────────────────────────────────────────
-- Stores the api_key / api_secret pairs that GilafStore PHP uses to
-- authenticate requests to all /api/integration/* endpoints.
-- Each key is bound to exactly one WACRM user account (user_id).
CREATE TABLE IF NOT EXISTS public.integration_keys (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_name    TEXT        NOT NULL DEFAULT 'Default',
  api_key     TEXT        NOT NULL UNIQUE,
  api_secret  TEXT        NOT NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  permissions JSONB       NOT NULL DEFAULT '["*"]'::jsonb,
  last_used_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookup index for every inbound request (hot path)
CREATE INDEX IF NOT EXISTS idx_integration_keys_api_key
  ON public.integration_keys(api_key);

-- Used by admin UI to list keys owned by a user
CREATE INDEX IF NOT EXISTS idx_integration_keys_user_id
  ON public.integration_keys(user_id);

-- Row-Level Security: users can only see and manage their own keys
ALTER TABLE public.integration_keys ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'integration_keys'
      AND policyname = 'Users manage own integration keys'
  ) THEN
    CREATE POLICY "Users manage own integration keys"
      ON public.integration_keys
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ─── 2. integration_webhook_logs ─────────────────────────────────────────────
-- Audit trail of every GilafStore event received by /api/integration/webhook.
-- Useful for debugging failed deliveries, replaying events, and compliance.
CREATE TABLE IF NOT EXISTS public.integration_webhook_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type    TEXT        NOT NULL,
  direction     TEXT        NOT NULL DEFAULT 'incoming',  -- 'incoming' | 'outgoing'
  endpoint      TEXT,
  payload       JSONB,
  response_code INTEGER,
  response_body TEXT,
  status        TEXT        NOT NULL DEFAULT 'received',  -- 'received' | 'delivered' | 'failed'
  duration_ms   INTEGER,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_integration_webhook_logs_user_created
  ON public.integration_webhook_logs(user_id, created_at DESC);

-- RLS: service-role bypasses (used by the integration routes via supabaseAdmin)
-- Dashboard UI queries can use the user-scoped client.
ALTER TABLE public.integration_webhook_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'integration_webhook_logs'
      AND policyname = 'Users see own webhook logs'
  ) THEN
    CREATE POLICY "Users see own webhook logs"
      ON public.integration_webhook_logs
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- ─── 3. integration_message_logs ─────────────────────────────────────────────
-- Log of every WhatsApp message sent through the integration layer
-- (send-otp, send-message endpoints).
CREATE TABLE IF NOT EXISTS public.integration_message_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone         TEXT        NOT NULL,
  template_name TEXT,
  message_text  TEXT,
  variables     JSONB,
  message_id    TEXT,        -- Meta message_id returned on success
  status        TEXT        NOT NULL DEFAULT 'sent',   -- 'sent' | 'failed'
  source        TEXT        NOT NULL DEFAULT 'gilafstore',
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_integration_message_logs_user_created
  ON public.integration_message_logs(user_id, created_at DESC);

ALTER TABLE public.integration_message_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'integration_message_logs'
      AND policyname = 'Users see own message logs'
  ) THEN
    CREATE POLICY "Users see own message logs"
      ON public.integration_message_logs
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;
