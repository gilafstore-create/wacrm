-- ============================================================
-- Migration 023: Security Center
-- ============================================================
-- Adds security event tracking, metrics calculation, IP blacklist,
-- and security score infrastructure
-- ============================================================

-- ─── 1. Security Events Table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Event Classification
  event_type TEXT NOT NULL, -- 'api_key_leak', 'ip_blacklisted', 'rate_limit_exceeded', 'suspicious_activity', 'webhook_signature_fail', 'auth_failure'
  severity TEXT NOT NULL, -- 'low', 'medium', 'high', 'critical'
  
  -- Event Details
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  api_key_id UUID REFERENCES public.api_keys(id) ON DELETE SET NULL,
  integration_id UUID REFERENCES public.website_integrations(id) ON DELETE SET NULL,
  
  -- Source
  ip_address TEXT,
  user_agent TEXT,
  endpoint TEXT,
  method TEXT,
  
  -- Event Data
  event_data JSONB,
  description TEXT,
  
  -- Resolution
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution_notes TEXT,
  
  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure all columns exist (handles partial table from a previous failed run)
ALTER TABLE public.security_events ADD COLUMN IF NOT EXISTS resolved BOOLEAN DEFAULT false;
ALTER TABLE public.security_events ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE public.security_events ADD COLUMN IF NOT EXISTS resolved_by TEXT;
ALTER TABLE public.security_events ADD COLUMN IF NOT EXISTS resolution_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON public.security_events(user_id);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON public.security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_security_events_severity ON public.security_events(severity);
CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON public.security_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_resolved ON public.security_events(resolved);

-- ─── 2. Security Metrics Table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.security_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Period
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  period_type TEXT NOT NULL, -- 'hourly', 'daily', 'weekly', 'monthly'
  
  -- Metrics
  total_requests INTEGER NOT NULL DEFAULT 0,
  failed_requests INTEGER NOT NULL DEFAULT 0,
  rate_limit_violations INTEGER NOT NULL DEFAULT 0,
  suspicious_ips INTEGER NOT NULL DEFAULT 0,
  webhook_signature_failures INTEGER NOT NULL DEFAULT 0,
  auth_failures INTEGER NOT NULL DEFAULT 0,
  
  -- API Key Security
  api_keys_active INTEGER NOT NULL DEFAULT 0,
  api_keys_expired INTEGER NOT NULL DEFAULT 0,
  api_keys_revoked INTEGER NOT NULL DEFAULT 0,
  api_keys_rotated INTEGER NOT NULL DEFAULT 0,
  
  -- Webhook Security
  webhook_deliveries INTEGER NOT NULL DEFAULT 0,
  webhook_failures INTEGER NOT NULL DEFAULT 0,
  webhook_success_rate NUMERIC(5,2),
  
  -- Integration Security
  integrations_active INTEGER NOT NULL DEFAULT 0,
  integrations_with_errors INTEGER NOT NULL DEFAULT 0,
  
  -- Calculated Score
  security_score INTEGER, -- 0-100
  risk_level TEXT, -- 'low', 'medium', 'high', 'critical'
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_security_metrics_period ON public.security_metrics(period_start, period_end, period_type);
CREATE INDEX IF NOT EXISTS idx_security_metrics_created_at ON public.security_metrics(created_at DESC);

-- ─── 3. IP Blacklist Table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ip_blacklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- IP Details
  ip_address TEXT NOT NULL UNIQUE,
  ip_range TEXT, -- CIDR notation
  country_code TEXT,
  
  -- Blacklist Reason
  reason TEXT NOT NULL,
  threat_type TEXT, -- 'malware', 'bot', 'spam', 'attack', 'custom'
  source TEXT, -- 'manual', 'automatic', 'threat_intel'
  
  -- Metadata
  added_by TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ, -- Temporary blacklist
  notes TEXT,
  
  -- Status
  active BOOLEAN DEFAULT true,
  violation_count INTEGER NOT NULL DEFAULT 0,
  last_violation_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ip_blacklist_ip_address ON public.ip_blacklist(ip_address);
CREATE INDEX IF NOT EXISTS idx_ip_blacklist_active ON public.ip_blacklist(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_ip_blacklist_expires_at ON public.ip_blacklist(expires_at) WHERE expires_at IS NOT NULL;

-- ─── 4. Security Score History Table ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.security_score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Score Breakdown
  overall_score INTEGER NOT NULL, -- 0-100
  ssl_score INTEGER, -- 0-20
  api_key_security_score INTEGER, -- 0-20
  webhook_validation_score INTEGER, -- 0-20
  secret_rotation_score INTEGER, -- 0-10
  failed_requests_score INTEGER, -- 0-10
  suspicious_ips_score INTEGER, -- 0-10
  rate_limit_score INTEGER, -- 0-10
  
  -- Risk Assessment
  risk_level TEXT NOT NULL, -- 'low', 'medium', 'high', 'critical'
  risk_factors JSONB,
  
  -- Recommendations
  recommendations TEXT[],
  
  -- Timestamp
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_score_history_calculated_at ON public.security_score_history(calculated_at DESC);

-- ─── 5. Row Level Security ─────────────────────────────────────────────
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ip_blacklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_score_history ENABLE ROW LEVEL SECURITY;

-- Service role has full access
GRANT ALL ON public.security_events TO service_role;
GRANT ALL ON public.security_metrics TO service_role;
GRANT ALL ON public.ip_blacklist TO service_role;
GRANT ALL ON public.security_score_history TO service_role;

-- Authenticated users can view security events related to them
CREATE POLICY "Users can view own security events"
  ON public.security_events FOR SELECT
  USING (auth.uid() = user_id);

-- Authenticated users can view security metrics (read-only)
CREATE POLICY "Users can view security metrics"
  ON public.security_metrics FOR SELECT
  USING (true);

-- Authenticated users can view IP blacklist (read-only)
CREATE POLICY "Users can view IP blacklist"
  ON public.ip_blacklist FOR SELECT
  USING (true);

-- Authenticated users can view security score history (read-only)
CREATE POLICY "Users can view security score history"
  ON public.security_score_history FOR SELECT
  USING (true);

-- ─── 6. Helper Function: Calculate Security Score ────────────────────
CREATE OR REPLACE FUNCTION public.calculate_security_score()
RETURNS TABLE (
  overall_score INTEGER,
  ssl_score INTEGER,
  api_key_security_score INTEGER,
  webhook_validation_score INTEGER,
  secret_rotation_score INTEGER,
  failed_requests_score INTEGER,
  suspicious_ips_score INTEGER,
  rate_limit_score INTEGER,
  risk_level TEXT,
  risk_factors JSONB,
  recommendations TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ssl_score INTEGER := 20;
  v_api_key_score INTEGER := 20;
  v_webhook_score INTEGER := 20;
  v_secret_score INTEGER := 10;
  v_failed_score INTEGER := 10;
  v_suspicious_score INTEGER := 10;
  v_rate_limit_score INTEGER := 10;
  v_overall_score INTEGER;
  v_risk_level TEXT := 'low';
  v_risk_factors JSONB := '[]'::jsonb;
  v_recommendations TEXT[] := ARRAY[]::TEXT[];
  
  v_total_keys INTEGER;
  v_expired_keys INTEGER;
  v_revoked_keys INTEGER;
  v_recent_rotations INTEGER;
  v_failed_requests INTEGER;
  v_total_requests INTEGER;
  v_suspicious_ips INTEGER;
  v_rate_limit_violations INTEGER;
  v_webhook_failures INTEGER;
  v_total_webhooks INTEGER;
BEGIN
  -- SSL Score (always 20 if using HTTPS)
  v_ssl_score := 20;
  
  -- API Key Security Score
  SELECT 
    COUNT(*) FILTER (WHERE status = 'active'),
    COUNT(*) FILTER (WHERE status = 'expired'),
    COUNT(*) FILTER (WHERE status = 'revoked'),
    COUNT(*) FILTER (WHERE last_rotated_at > now() - INTERVAL '90 days')
  INTO v_total_keys, v_expired_keys, v_revoked_keys, v_recent_rotations
  FROM public.api_keys;
  
  IF v_total_keys > 0 THEN
    v_api_key_score := 20 - 
      (v_expired_keys * 5) - 
      (v_revoked_keys * 3);
    IF v_api_key_score < 0 THEN v_api_key_score := 0; END IF;
  END IF;
  
  -- Secret Rotation Score
  IF v_total_keys > 0 THEN
    v_secret_score := (v_recent_rotations::FLOAT / v_total_keys::FLOAT * 10)::INTEGER;
  END IF;
  
  -- Failed Requests Score
  SELECT 
    COALESCE(SUM(failed_requests), 0),
    COALESCE(SUM(total_requests), 0)
  INTO v_failed_requests, v_total_requests
  FROM public.security_metrics
  WHERE period_start > now() - INTERVAL '24 hours';
  
  IF v_total_requests > 0 THEN
    v_failed_score := 10 - ((v_failed_requests::FLOAT / v_total_requests::FLOAT) * 10)::INTEGER;
    IF v_failed_score < 0 THEN v_failed_score := 0; END IF;
  END IF;
  
  -- Suspicious IPs Score
  SELECT COUNT(*) INTO v_suspicious_ips
  FROM public.ip_blacklist
  WHERE active = true;
  
  v_suspicious_score := GREATEST(10 - v_suspicious_ips, 0);
  
  -- Rate Limit Score
  SELECT COALESCE(SUM(rate_limit_violations), 0) INTO v_rate_limit_violations
  FROM public.security_metrics
  WHERE period_start > now() - INTERVAL '24 hours';
  
  v_rate_limit_score := GREATEST(10 - v_rate_limit_violations, 0);
  
  -- Webhook Validation Score
  SELECT 
    COALESCE(SUM(webhook_failures), 0),
    COALESCE(SUM(webhook_deliveries), 0)
  INTO v_webhook_failures, v_total_webhooks
  FROM public.security_metrics
  WHERE period_start > now() - INTERVAL '24 hours';
  
  IF v_total_webhooks > 0 THEN
    v_webhook_score := 20 - ((v_webhook_failures::FLOAT / v_total_webhooks::FLOAT) * 20)::INTEGER;
    IF v_webhook_score < 0 THEN v_webhook_score := 0; END IF;
  END IF;
  
  -- Calculate Overall Score
  v_overall_score := v_ssl_score + v_api_key_score + v_webhook_score + 
                     v_secret_score + v_failed_score + v_suspicious_score + v_rate_limit_score;
  
  -- Determine Risk Level
  IF v_overall_score >= 80 THEN
    v_risk_level := 'low';
  ELSIF v_overall_score >= 60 THEN
    v_risk_level := 'medium';
  ELSIF v_overall_score >= 40 THEN
    v_risk_level := 'high';
  ELSE
    v_risk_level := 'critical';
  END IF;
  
  -- Build Risk Factors
  IF v_expired_keys > 0 THEN
    v_risk_factors := v_risk_factors || jsonb_build_object('type', 'expired_keys', 'count', v_expired_keys);
    v_recommendations := v_recommendations || 'Rotate or revoke expired API keys';
  END IF;
  
  IF v_suspicious_ips > 0 THEN
    v_risk_factors := v_risk_factors || jsonb_build_object('type', 'suspicious_ips', 'count', v_suspicious_ips);
    v_recommendations := v_recommendations || 'Review and block suspicious IP addresses';
  END IF;
  
  IF v_rate_limit_violations > 5 THEN
    v_risk_factors := v_risk_factors || jsonb_build_object('type', 'rate_limit_violations', 'count', v_rate_limit_violations);
    v_recommendations := v_recommendations || 'Investigate rate limit violations - possible attack';
  END IF;
  
  IF v_webhook_failures > 10 THEN
    v_risk_factors := v_risk_factors || jsonb_build_object('type', 'webhook_failures', 'count', v_webhook_failures);
    v_recommendations := v_recommendations || 'Review webhook delivery failures';
  END IF;
  
  RETURN QUERY SELECT 
    v_overall_score, v_ssl_score, v_api_key_score, v_webhook_score,
    v_secret_score, v_failed_score, v_suspicious_score, v_rate_limit_score,
    v_risk_level, v_risk_factors, v_recommendations;
END;
$$;

-- ─── 7. Helper Function: Log Security Event ─────────────────────────
CREATE OR REPLACE FUNCTION public.log_security_event(
  p_event_type TEXT,
  p_severity TEXT,
  p_user_id UUID,
  p_api_key_id UUID,
  p_integration_id UUID,
  p_ip_address TEXT,
  p_user_agent TEXT,
  p_endpoint TEXT,
  p_method TEXT,
  p_event_data JSONB,
  p_description TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_id UUID;
BEGIN
  INSERT INTO public.security_events (
    event_type, severity, user_id, api_key_id, integration_id,
    ip_address, user_agent, endpoint, method, event_data, description
  ) VALUES (
    p_event_type, p_severity, p_user_id, p_api_key_id, p_integration_id,
    p_ip_address, p_user_agent, p_endpoint, p_method, p_event_data, p_description
  ) RETURNING id INTO v_event_id;
  
  -- Auto-blacklist on critical events
  IF p_severity = 'critical' AND p_ip_address IS NOT NULL THEN
    INSERT INTO public.ip_blacklist (ip_address, reason, threat_type, source, added_by)
    VALUES (p_ip_address, p_description, 'attack', 'automatic', 'system')
    ON CONFLICT (ip_address) DO UPDATE SET
      active = true,
      violation_count = ip_blacklist.violation_count + 1,
      last_violation_at = now();
  END IF;
  
  RETURN v_event_id;
END;
$$;

-- ─── 8. Helper Function: Check IP Blacklist ─────────────────────────
CREATE OR REPLACE FUNCTION public.is_ip_blacklisted(p_ip_address TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ip_blacklist
    WHERE ip_address = p_ip_address
    AND active = true
    AND (expires_at IS NULL OR expires_at > now())
  )
$$;
