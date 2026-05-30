-- ============================================================
-- Migration 017: Enterprise Security & Feature Tables
-- ============================================================
-- All statements are idempotent (IF NOT EXISTS).
-- ADDITIVE ONLY — no existing tables or columns are modified.
-- ============================================================

-- ─── 1. integration_rate_limit_logs ─────────────────────────
CREATE TABLE IF NOT EXISTS public.integration_rate_limit_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  api_key       TEXT,
  ip_address    TEXT,
  route         TEXT        NOT NULL,
  violation_type TEXT       NOT NULL DEFAULT 'rate_limit', -- 'rate_limit' | 'abuse'
  request_count INTEGER     NOT NULL DEFAULT 1,
  window_reset_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_irl_api_key_created
  ON public.integration_rate_limit_logs(api_key, created_at DESC);
ALTER TABLE public.integration_rate_limit_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='integration_rate_limit_logs' AND policyname='Users see own rate limit logs') THEN
    CREATE POLICY "Users see own rate limit logs" ON public.integration_rate_limit_logs FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

-- ─── 2. integration_webhook_nonces (replay protection) ───────
CREATE TABLE IF NOT EXISTS public.integration_webhook_nonces (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce       TEXT        NOT NULL UNIQUE,  -- sha256(apiKey+timestamp+bodyHash)
  api_key     TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_iwn_nonce ON public.integration_webhook_nonces(nonce);
CREATE INDEX IF NOT EXISTS idx_iwn_expires ON public.integration_webhook_nonces(expires_at);
ALTER TABLE public.integration_webhook_nonces ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='integration_webhook_nonces' AND policyname='Service role only') THEN
    CREATE POLICY "Service role only" ON public.integration_webhook_nonces FOR ALL USING (false);
  END IF;
END $$;

-- ─── 3. security_events ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.security_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type    TEXT        NOT NULL, -- 'invalid_signature'|'replay_attack'|'rate_limit'|'key_revoked'|'brute_force'
  severity      TEXT        NOT NULL DEFAULT 'medium', -- 'low'|'medium'|'high'|'critical'
  ip_address    TEXT,
  api_key_prefix TEXT,               -- first 8 chars only, never full key
  route         TEXT,
  details       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_se_user_created ON public.security_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_se_event_type   ON public.security_events(event_type, created_at DESC);
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='security_events' AND policyname='Users see own security events') THEN
    CREATE POLICY "Users see own security events" ON public.security_events FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

-- ─── 4. connection_tokens (One-Token Setup) ──────────────────
CREATE TABLE IF NOT EXISTS public.connection_tokens (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token         TEXT        NOT NULL UNIQUE, -- gs_connect_xxxx format
  label         TEXT        NOT NULL DEFAULT 'Default Connection',
  is_used       BOOLEAN     NOT NULL DEFAULT false,
  used_at       TIMESTAMPTZ,
  integration_key_id UUID  REFERENCES public.integration_keys(id) ON DELETE SET NULL,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ct_token   ON public.connection_tokens(token);
CREATE INDEX IF NOT EXISTS idx_ct_user_id ON public.connection_tokens(user_id);
ALTER TABLE public.connection_tokens ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='connection_tokens' AND policyname='Users manage own connection tokens') THEN
    CREATE POLICY "Users manage own connection tokens" ON public.connection_tokens FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ─── 5. heartbeat_logs ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.heartbeat_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  status        TEXT        NOT NULL DEFAULT 'ok', -- 'ok'|'timeout'|'error'
  latency_ms    INTEGER,
  error_message TEXT,
  render_online BOOLEAN,
  db_online     BOOLEAN,
  wa_online     BOOLEAN,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hl_user_created ON public.heartbeat_logs(user_id, created_at DESC);
ALTER TABLE public.heartbeat_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='heartbeat_logs' AND policyname='Users see own heartbeat logs') THEN
    CREATE POLICY "Users see own heartbeat logs" ON public.heartbeat_logs FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

-- ─── 6. Additive columns on integration_keys (safe) ──────────
-- revoked_at: for key revocation support
ALTER TABLE public.integration_keys
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- rotation_parent_id: points to key that was rotated
ALTER TABLE public.integration_keys
  ADD COLUMN IF NOT EXISTS rotation_parent_id UUID REFERENCES public.integration_keys(id) ON DELETE SET NULL;

-- is_bcrypt: flag new-style keys with bcrypt secrets
ALTER TABLE public.integration_keys
  ADD COLUMN IF NOT EXISTS is_bcrypt BOOLEAN NOT NULL DEFAULT false;

-- key_prefix: gs_live_ prefix for display (first 12 chars)
ALTER TABLE public.integration_keys
  ADD COLUMN IF NOT EXISTS key_prefix TEXT;
