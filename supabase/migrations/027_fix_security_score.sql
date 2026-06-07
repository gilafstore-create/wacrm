-- Migration 027: Fix calculate_security_score
-- Root cause: v_recent_rotations only counted last_rotated_at > 90 days ago,
-- ignoring newly-created keys that have never been rotated (last_rotated_at IS NULL).
-- Fix: treat keys created within the 90-day window as compliant so a fresh
-- integration doesn't start at 0/10 for secret rotation.

CREATE OR REPLACE FUNCTION public.calculate_security_score()
RETURNS TABLE (
  overall_score INTEGER,
  ssl_score INTEGER,
  api_key_score INTEGER,
  webhook_score INTEGER,
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
  -- SSL Score (always full if using HTTPS)
  v_ssl_score := 20;

  -- API Key Security Score
  -- FIX: count a key as "recently rotated" if last_rotated_at is within 90 days
  -- OR if the key was created within 90 days and has never been rotated yet
  -- (new keys should not penalise the score)
  SELECT
    COUNT(*) FILTER (WHERE status = 'active'),
    COUNT(*) FILTER (WHERE status = 'expired'),
    COUNT(*) FILTER (WHERE status = 'revoked'),
    COUNT(*) FILTER (
      WHERE last_rotated_at > now() - INTERVAL '90 days'
         OR (last_rotated_at IS NULL AND created_at > now() - INTERVAL '90 days')
    )
  INTO v_total_keys, v_expired_keys, v_revoked_keys, v_recent_rotations
  FROM public.api_keys;

  IF v_total_keys > 0 THEN
    v_api_key_score := 20 -
      (v_expired_keys * 5) -
      (v_revoked_keys * 3);
    IF v_api_key_score < 0 THEN v_api_key_score := 0; END IF;
  END IF;

  -- Secret Rotation Score (fixed: new keys count as compliant)
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

  -- Overall Score
  v_overall_score := v_ssl_score + v_api_key_score + v_webhook_score +
                     v_secret_score + v_failed_score + v_suspicious_score + v_rate_limit_score;

  -- Risk Level
  IF v_overall_score >= 80 THEN
    v_risk_level := 'low';
  ELSIF v_overall_score >= 60 THEN
    v_risk_level := 'medium';
  ELSIF v_overall_score >= 40 THEN
    v_risk_level := 'high';
  ELSE
    v_risk_level := 'critical';
  END IF;

  -- Risk Factors
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
    v_recommendations := v_recommendations || 'Investigate rate limit violations';
  END IF;

  IF v_recent_rotations < v_total_keys THEN
    v_risk_factors := v_risk_factors || jsonb_build_object('type', 'unrotated_keys', 'count', v_total_keys - v_recent_rotations);
    v_recommendations := v_recommendations || 'Rotate API keys that have not been rotated in over 90 days';
  END IF;

  RETURN QUERY SELECT
    v_overall_score,
    v_ssl_score,
    v_api_key_score,
    v_webhook_score,
    v_secret_score,
    v_failed_score,
    v_suspicious_score,
    v_rate_limit_score,
    v_risk_level,
    v_risk_factors,
    v_recommendations;
END;
$$;
