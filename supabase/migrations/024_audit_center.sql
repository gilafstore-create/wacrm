-- ============================================================
-- Migration 024: Audit Center
-- ============================================================
-- Comprehensive audit logging for all system actions
-- Tracks API key operations, webhook changes, settings modifications,
-- sync events, and all user actions
-- ============================================================

-- ─── 1. Audit Logs Table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Actor
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email TEXT,
  user_role TEXT,
  
  -- Action
  action_type TEXT NOT NULL, -- 'api_key_created', 'api_key_revoked', 'webhook_changed', 'settings_modified', 'sync_started', 'sync_failed', 'integration_created', 'integration_deleted', 'user_login', 'user_logout'
  action_category TEXT NOT NULL, -- 'api_keys', 'webhooks', 'settings', 'sync', 'integrations', 'auth', 'security'
  
  -- Target
  target_type TEXT, -- 'api_key', 'webhook', 'integration', 'setting', 'user'
  target_id UUID,
  target_name TEXT,
  
  -- Changes
  previous_state JSONB,
  new_state JSONB,
  changed_fields TEXT[],
  
  -- Context
  ip_address TEXT,
  user_agent TEXT,
  endpoint TEXT,
  method TEXT,
  
  -- Metadata
  description TEXT,
  reason TEXT,
  tags TEXT[],
  
  -- Result
  success BOOLEAN DEFAULT true,
  error_message TEXT,
  
  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON public.audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_category ON public.audit_logs(action_category);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_type ON public.audit_logs(target_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_id ON public.audit_logs(target_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_success ON public.audit_logs(success);

-- ─── 2. Audit Log Aggregation Table (for dashboard metrics) ───────
CREATE TABLE IF NOT EXISTS public.audit_log_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Period
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  period_type TEXT NOT NULL, -- 'hourly', 'daily', 'weekly', 'monthly'
  
  -- Action Counts
  api_key_actions INTEGER NOT NULL DEFAULT 0,
  webhook_actions INTEGER NOT NULL DEFAULT 0,
  settings_actions INTEGER NOT NULL DEFAULT 0,
  sync_actions INTEGER NOT NULL DEFAULT 0,
  integration_actions INTEGER NOT NULL DEFAULT 0,
  auth_actions INTEGER NOT NULL DEFAULT 0,
  security_actions INTEGER NOT NULL DEFAULT 0,
  
  -- Success/Failure
  total_actions INTEGER NOT NULL DEFAULT 0,
  successful_actions INTEGER NOT NULL DEFAULT 0,
  failed_actions INTEGER NOT NULL DEFAULT 0,
  
  -- User Activity
  unique_users INTEGER NOT NULL DEFAULT 0,
  most_active_user TEXT,
  
  -- Top Actions
  top_action_type TEXT,
  top_action_count INTEGER,
  
  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_log_metrics_period ON public.audit_log_metrics(period_start, period_end, period_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_metrics_created_at ON public.audit_log_metrics(created_at DESC);

-- ─── 3. Row Level Security ─────────────────────────────────────────────
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log_metrics ENABLE ROW LEVEL SECURITY;

-- Service role has full access
GRANT ALL ON public.audit_logs TO service_role;
GRANT ALL ON public.audit_log_metrics TO service_role;

-- Authenticated users can view their own audit logs
CREATE POLICY "Users can view own audit logs"
  ON public.audit_logs FOR SELECT
  USING (auth.uid() = user_id);

-- Admin users can view all audit logs (requires is_admin function or similar)
-- For now, allow authenticated users to view all (adjust based on RBAC)
CREATE POLICY "Authenticated users can view audit logs"
  ON public.audit_logs FOR SELECT
  USING (true);

-- Authenticated users can view audit metrics (read-only)
CREATE POLICY "Users can view audit metrics"
  ON public.audit_log_metrics FOR SELECT
  USING (true);

-- ─── 4. Helper Function: Log Audit Event ───────────────────────────
CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_action_type TEXT,
  p_action_category TEXT,
  p_target_type TEXT,
  p_target_id UUID,
  p_target_name TEXT,
  p_previous_state JSONB,
  p_new_state JSONB,
  p_changed_fields TEXT[],
  p_ip_address TEXT,
  p_user_agent TEXT,
  p_endpoint TEXT,
  p_method TEXT,
  p_description TEXT,
  p_reason TEXT,
  p_tags TEXT[],
  p_success BOOLEAN,
  p_error_message TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_log_id UUID;
  v_user_email TEXT;
BEGIN
  -- Get user email
  SELECT email INTO v_user_email
  FROM auth.users
  WHERE id = auth.uid();
  
  INSERT INTO public.audit_logs (
    user_id, user_email, action_type, action_category,
    target_type, target_id, target_name,
    previous_state, new_state, changed_fields,
    ip_address, user_agent, endpoint, method,
    description, reason, tags, success, error_message
  ) VALUES (
    auth.uid(), v_user_email, p_action_type, p_action_category,
    p_target_type, p_target_id, p_target_name,
    p_previous_state, p_new_state, p_changed_fields,
    p_ip_address, p_user_agent, p_endpoint, p_method,
    p_description, p_reason, p_tags, p_success, p_error_message
  ) RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$;

-- ─── 5. Helper Function: Auto-Log API Key Actions ─────────────────
CREATE OR REPLACE FUNCTION public.audit_api_key_action_wrapper()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_action_type TEXT;
  v_action_category TEXT := 'api_keys';
  v_previous_state JSONB;
  v_new_state JSONB;
  v_changed_fields TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action_type := 'api_key_created';
    v_new_state := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status != NEW.status THEN
      IF NEW.status = 'revoked' THEN
        v_action_type := 'api_key_revoked';
      ELSIF NEW.status = 'disabled' THEN
        v_action_type := 'api_key_disabled';
      ELSIF NEW.status = 'active' AND OLD.status != 'active' THEN
        v_action_type := 'api_key_enabled';
      ELSE
        v_action_type := 'api_key_updated';
      END IF;
      v_changed_fields := v_changed_fields || 'status';
    END IF;
    
    IF OLD.key_hash != NEW.key_hash THEN
      v_action_type := 'api_key_regenerated';
      v_changed_fields := v_changed_fields || 'key_hash';
    END IF;
    
    IF OLD.scope != NEW.scope THEN
      v_action_type := 'api_key_permissions_changed';
      v_changed_fields := v_changed_fields || 'scope';
    END IF;
    
    v_previous_state := to_jsonb(OLD);
    v_new_state := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    v_action_type := 'api_key_deleted';
    v_previous_state := to_jsonb(OLD);
  END IF;
  
  -- Log the action
  INSERT INTO public.audit_logs (
    user_id, action_type, action_category,
    target_type, target_id, target_name,
    previous_state, new_state, changed_fields,
    description, success
  ) VALUES (
    NEW.user_id, v_action_type, v_action_category,
    'api_key', NEW.id, NEW.key_name,
    v_previous_state, v_new_state, v_changed_fields,
    'API key ' || v_action_type, true
  );
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_audit_api_key_actions
  AFTER INSERT OR UPDATE OR DELETE ON public.api_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_api_key_action_wrapper();

-- NOTE: Integration action audit logging is handled explicitly by API routes,
-- not via trigger, to avoid audit log noise from scheduler sync updates.

-- ─── 7. Helper Function: Aggregate Audit Metrics ───────────────────
CREATE OR REPLACE FUNCTION public.aggregate_audit_metrics(p_period_type TEXT DEFAULT 'daily')
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_period_start TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ;
  v_api_key_actions INTEGER;
  v_webhook_actions INTEGER;
  v_settings_actions INTEGER;
  v_sync_actions INTEGER;
  v_integration_actions INTEGER;
  v_auth_actions INTEGER;
  v_security_actions INTEGER;
  v_total_actions INTEGER;
  v_successful_actions INTEGER;
  v_failed_actions INTEGER;
  v_unique_users INTEGER;
  v_most_active_user TEXT;
  v_top_action_type TEXT;
  v_top_action_count INTEGER;
BEGIN
  -- Calculate period bounds
  CASE p_period_type
    WHEN 'hourly' THEN
      v_period_start := date_trunc('hour', now() - INTERVAL '1 hour');
      v_period_end := date_trunc('hour', now());
    WHEN 'daily' THEN
      v_period_start := date_trunc('day', now() - INTERVAL '1 day');
      v_period_end := date_trunc('day', now());
    WHEN 'weekly' THEN
      v_period_start := date_trunc('week', now() - INTERVAL '1 week');
      v_period_end := date_trunc('week', now());
    WHEN 'monthly' THEN
      v_period_start := date_trunc('month', now() - INTERVAL '1 month');
      v_period_end := date_trunc('month', now());
  END CASE;
  
  -- Calculate metrics
  SELECT 
    COUNT(*) FILTER (WHERE action_category = 'api_keys'),
    COUNT(*) FILTER (WHERE action_category = 'webhooks'),
    COUNT(*) FILTER (WHERE action_category = 'settings'),
    COUNT(*) FILTER (WHERE action_category = 'sync'),
    COUNT(*) FILTER (WHERE action_category = 'integrations'),
    COUNT(*) FILTER (WHERE action_category = 'auth'),
    COUNT(*) FILTER (WHERE action_category = 'security'),
    COUNT(*),
    COUNT(*) FILTER (WHERE success = true),
    COUNT(*) FILTER (WHERE success = false),
    COUNT(DISTINCT user_id)
  INTO 
    v_api_key_actions, v_webhook_actions, v_settings_actions, v_sync_actions,
    v_integration_actions, v_auth_actions, v_security_actions, v_total_actions,
    v_successful_actions, v_failed_actions, v_unique_users
  FROM public.audit_logs
  WHERE created_at >= v_period_start AND created_at < v_period_end;
  
  -- Find most active user
  SELECT user_email INTO v_most_active_user
  FROM public.audit_logs
  WHERE created_at >= v_period_start AND created_at < v_period_end
  GROUP BY user_email
  ORDER BY COUNT(*) DESC
  LIMIT 1;
  
  -- Find top action type
  SELECT action_type, COUNT(*) INTO v_top_action_type, v_top_action_count
  FROM public.audit_logs
  WHERE created_at >= v_period_start AND created_at < v_period_end
  GROUP BY action_type
  ORDER BY COUNT(*) DESC
  LIMIT 1;
  
  -- Upsert metrics
  INSERT INTO public.audit_log_metrics (
    period_start, period_end, period_type,
    api_key_actions, webhook_actions, settings_actions, sync_actions,
    integration_actions, auth_actions, security_actions,
    total_actions, successful_actions, failed_actions,
    unique_users, most_active_user, top_action_type, top_action_count
  ) VALUES (
    v_period_start, v_period_end, p_period_type,
    v_api_key_actions, v_webhook_actions, v_settings_actions, v_sync_actions,
    v_integration_actions, v_auth_actions, v_security_actions,
    v_total_actions, v_successful_actions, v_failed_actions,
    v_unique_users, v_most_active_user, v_top_action_type, v_top_action_count
  )
  ON CONFLICT (period_start, period_end, period_type) DO UPDATE SET
    api_key_actions = EXCLUDED.api_key_actions,
    webhook_actions = EXCLUDED.webhook_actions,
    settings_actions = EXCLUDED.settings_actions,
    sync_actions = EXCLUDED.sync_actions,
    integration_actions = EXCLUDED.integration_actions,
    auth_actions = EXCLUDED.auth_actions,
    security_actions = EXCLUDED.security_actions,
    total_actions = EXCLUDED.total_actions,
    successful_actions = EXCLUDED.successful_actions,
    failed_actions = EXCLUDED.failed_actions,
    unique_users = EXCLUDED.unique_users,
    most_active_user = EXCLUDED.most_active_user,
    top_action_type = EXCLUDED.top_action_type,
    top_action_count = EXCLUDED.top_action_count,
    updated_at = now();
END;
$$;
