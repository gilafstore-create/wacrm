-- ============================================================
-- Migration 022: Enterprise API Key Management System
-- ============================================================
-- Replaces simple API key system with enterprise-grade key management
-- including types, expiry, permissions, restrictions, and full audit trail
-- ============================================================

-- ─── 1. API Keys Table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Key Identity
  key_name TEXT NOT NULL,
  key_prefix TEXT NOT NULL, -- First 8 chars for display (e.g., "gilaf_...")
  key_hash TEXT NOT NULL UNIQUE, -- SHA-256 hash of full key
  key_fingerprint TEXT, -- SHA-256 of key + user_id + created_at for verification
  
  -- Expiry & Type
  key_type TEXT NOT NULL DEFAULT 'never_expire', -- 'never_expire', '24h', '7d', '30d', '90d', '1y', 'custom'
  expires_at TIMESTAMPTZ,
  custom_expiry_days INTEGER, -- For custom type
  
  -- Ownership
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL, -- User email or 'system'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Usage Tracking
  last_used_at TIMESTAMPTZ,
  last_used_ip TEXT,
  last_used_user_agent TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'disabled', 'revoked', 'expired'
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  revoked_reason TEXT,
  
  -- Security Restrictions
  ip_whitelist TEXT[], -- Array of allowed IPs/CIDRs
  ip_blacklist TEXT[], -- Array of blocked IPs/CIDRs
  domain_whitelist TEXT[], -- Array of allowed domains for CORS
  rate_limit_per_minute INTEGER DEFAULT 60,
  rate_limit_per_hour INTEGER DEFAULT 1000,
  
  -- Scope Permissions
  scope TEXT[] NOT NULL DEFAULT '{"read", "write"}', -- 'read', 'write', 'admin', 'sync', 'webhook'
  allowed_endpoints TEXT[], -- Specific endpoints allowed (null = all)
  denied_endpoints TEXT[], -- Specific endpoints denied
  
  -- Metadata
  description TEXT,
  tags TEXT[],
  
  -- Audit
  last_rotated_at TIMESTAMPTZ,
  rotation_count INTEGER NOT NULL DEFAULT 0,
  
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON public.api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_status ON public.api_keys(status);
CREATE INDEX IF NOT EXISTS idx_api_keys_expires_at ON public.api_keys(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON public.api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON public.api_keys(key_prefix);

-- ─── 2. API Key Usage Logs Table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_key_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  key_id UUID NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Request Details
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  
  -- Response Details
  status_code INTEGER NOT NULL,
  response_time_ms INTEGER,
  
  -- Security
  rate_limit_exceeded BOOLEAN DEFAULT false,
  ip_allowed BOOLEAN DEFAULT true,
  domain_allowed BOOLEAN DEFAULT true,
  scope_allowed BOOLEAN DEFAULT true,
  
  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_logs_key_id ON public.api_key_usage_logs(key_id);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_logs_created_at ON public.api_key_usage_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_logs_user_id ON public.api_key_usage_logs(user_id);

-- ─── 3. API Key Audit Log Table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_key_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  key_id UUID NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Action Details
  action TEXT NOT NULL, -- 'created', 'regenerated', 'rotated', 'revoked', 'disabled', 'enabled', 'permission_changed'
  previous_state JSONB,
  new_state JSONB,
  
  -- Context
  ip_address TEXT,
  user_agent TEXT,
  reason TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_key_audit_logs_key_id ON public.api_key_audit_logs(key_id);
CREATE INDEX IF NOT EXISTS idx_api_key_audit_logs_created_at ON public.api_key_audit_logs(created_at DESC);

-- ─── 4. Row Level Security ─────────────────────────────────────────────
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- Users can only see their own keys
CREATE POLICY "Users can view own API keys"
  ON public.api_keys FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own API keys"
  ON public.api_keys FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own API keys"
  ON public.api_keys FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own API keys"
  ON public.api_keys FOR DELETE
  USING (auth.uid() = user_id);

-- Service role has full access
GRANT ALL ON public.api_keys TO service_role;
GRANT ALL ON public.api_key_usage_logs TO service_role;
GRANT ALL ON public.api_key_audit_logs TO service_role;

-- Authenticated users can read their own usage logs
ALTER TABLE public.api_key_usage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own API key usage logs"
  ON public.api_key_usage_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.api_keys 
      WHERE api_keys.id = api_key_usage_logs.key_id 
      AND api_keys.user_id = auth.uid()
    )
  );

-- Authenticated users can read their own audit logs
ALTER TABLE public.api_key_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own API key audit logs"
  ON public.api_key_audit_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.api_keys 
      WHERE api_keys.id = api_key_audit_logs.key_id 
      AND api_keys.user_id = auth.uid()
    )
  );

-- ─── 5. Helper Function: Generate API Key ─────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_api_key()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  key_prefix TEXT;
  key_secret TEXT;
  full_key TEXT;
BEGIN
  -- Generate random 32-byte key
  key_secret := encode(gen_random_bytes(32), 'base64');
  -- Remove base64 padding
  key_secret := regexp_replace(key_secret, '=+$', '');
  -- Add prefix
  key_prefix := 'gilaf_' || substr(encode(gen_random_bytes(4), 'hex'), 1, 8);
  full_key := key_prefix || '_' || key_secret;
  
  RETURN full_key;
END;
$$;

-- ─── 6. Helper Function: Hash API Key ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.hash_api_key(p_key TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT encode(digest(p_key, 'sha256'), 'hex')
$$;

-- ─── 7. Helper Function: Check API Key Expiry ─────────────────────────
CREATE OR REPLACE FUNCTION public.check_api_key_expiry()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.expires_at IS NOT NULL AND NEW.expires_at < now() AND NEW.status = 'active' THEN
    NEW.status := 'expired';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_check_api_key_expiry
  BEFORE INSERT OR UPDATE ON public.api_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.check_api_key_expiry();

-- ─── 8. Helper Function: Log API Key Usage ────────────────────────────
CREATE OR REPLACE FUNCTION public.log_api_key_usage(
  p_key_id UUID,
  p_endpoint TEXT,
  p_method TEXT,
  p_ip_address TEXT,
  p_user_agent TEXT,
  p_status_code INTEGER,
  p_response_time_ms INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.api_key_usage_logs (
    key_id, endpoint, method, ip_address, user_agent, 
    status_code, response_time_ms
  ) VALUES (
    p_key_id, p_endpoint, p_method, p_ip_address, p_user_agent,
    p_status_code, p_response_time_ms
  );
  
  -- Update usage count and last used
  UPDATE public.api_keys
  SET 
    usage_count = usage_count + 1,
    last_used_at = now(),
    last_used_ip = p_ip_address,
    last_used_user_agent = p_user_agent
  WHERE id = p_key_id;
END;
$$;

-- ─── 9. Helper Function: Audit API Key Action ────────────────────────
CREATE OR REPLACE FUNCTION public.audit_api_key_action(
  p_key_id UUID,
  p_action TEXT,
  p_previous_state JSONB,
  p_new_state JSONB,
  p_ip_address TEXT,
  p_user_agent TEXT,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.api_key_audit_logs (
    key_id, user_id, action, previous_state, new_state,
    ip_address, user_agent, reason
  ) VALUES (
    p_key_id, auth.uid(), p_action, p_previous_state, p_new_state,
    p_ip_address, p_user_agent, p_reason
  );
END;
$$;
