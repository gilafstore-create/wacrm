-- ============================================================
-- Migration 025: Analytics & Performance Metrics
-- ============================================================
-- Time-series metrics aggregation for analytics dashboard
-- Includes request metrics, sync metrics, webhook metrics, and performance data
-- ============================================================

-- ─── 1. Request Metrics Table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.request_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Period
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  period_type TEXT NOT NULL, -- 'hourly', 'daily', 'weekly', 'monthly'
  
  -- Request Counts
  total_requests INTEGER NOT NULL DEFAULT 0,
  successful_requests INTEGER NOT NULL DEFAULT 0,
  failed_requests INTEGER NOT NULL DEFAULT 0,
  
  -- Request Breakdown by Endpoint
  requests_by_endpoint JSONB, -- {"/api/integrations": 100, "/api/webhook": 50}
  
  -- Request Breakdown by Method
  requests_by_method JSONB, -- {"GET": 100, "POST": 50, "PUT": 10}
  
  -- Response Time Metrics
  avg_response_time_ms NUMERIC(10,2),
  p50_response_time_ms INTEGER,
  p95_response_time_ms INTEGER,
  p99_response_time_ms INTEGER,
  max_response_time_ms INTEGER,
  
  -- Error Metrics
  error_rate NUMERIC(5,2),
  errors_by_status JSONB, -- {"400": 10, "401": 5, "500": 2}
  
  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_request_metrics_period ON public.request_metrics(period_start, period_end, period_type);
CREATE INDEX IF NOT EXISTS idx_request_metrics_created_at ON public.request_metrics(created_at DESC);

-- ─── 2. Sync Metrics Table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sync_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Period
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  period_type TEXT NOT NULL, -- 'hourly', 'daily', 'weekly', 'monthly'
  
  -- Sync Counts
  total_syncs INTEGER NOT NULL DEFAULT 0,
  successful_syncs INTEGER NOT NULL DEFAULT 0,
  failed_syncs INTEGER NOT NULL DEFAULT 0,
  
  -- Records Synced
  total_contacts_synced INTEGER NOT NULL DEFAULT 0,
  total_orders_synced INTEGER NOT NULL DEFAULT 0,
  total_products_synced INTEGER NOT NULL DEFAULT 0,
  
  -- Sync Duration
  avg_sync_duration_ms NUMERIC(10,2),
  p50_sync_duration_ms INTEGER,
  p95_sync_duration_ms INTEGER,
  max_sync_duration_ms INTEGER,
  
  -- Sync Success Rate
  sync_success_rate NUMERIC(5,2),
  
  -- Integration Breakdown
  syncs_by_integration JSONB, -- {integration_id: {total: 10, success: 9, failed: 1}}
  
  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_metrics_period ON public.sync_metrics(period_start, period_end, period_type);
CREATE INDEX IF NOT EXISTS idx_sync_metrics_created_at ON public.sync_metrics(created_at DESC);

-- ─── 3. Webhook Metrics Table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Period
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  period_type TEXT NOT NULL, -- 'hourly', 'daily', 'weekly', 'monthly'
  
  -- Delivery Counts
  total_deliveries INTEGER NOT NULL DEFAULT 0,
  successful_deliveries INTEGER NOT NULL DEFAULT 0,
  failed_deliveries INTEGER NOT NULL DEFAULT 0,
  retried_deliveries INTEGER NOT NULL DEFAULT 0,
  
  -- Event Types
  deliveries_by_event_type JSONB, -- {"sync.completed": 100, "contact.updated": 50}
  
  -- Delivery Duration
  avg_delivery_time_ms NUMERIC(10,2),
  p50_delivery_time_ms INTEGER,
  p95_delivery_time_ms INTEGER,
  max_delivery_time_ms INTEGER,
  
  -- Success Rate
  delivery_success_rate NUMERIC(5,2),
  
  -- Integration Breakdown
  deliveries_by_integration JSONB, -- {integration_id: {total: 100, success: 95, failed: 5}}
  
  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_metrics_period ON public.webhook_metrics(period_start, period_end, period_type);
CREATE INDEX IF NOT EXISTS idx_webhook_metrics_created_at ON public.webhook_metrics(created_at DESC);

-- ─── 4. Performance Metrics Table ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.performance_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Period
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  period_type TEXT NOT NULL, -- 'hourly', 'daily', 'weekly', 'monthly'
  
  -- API Latency
  avg_api_latency_ms NUMERIC(10,2),
  p50_api_latency_ms INTEGER,
  p95_api_latency_ms INTEGER,
  p99_api_latency_ms INTEGER,
  
  -- Database Latency
  avg_db_latency_ms NUMERIC(10,2),
  p50_db_latency_ms INTEGER,
  p95_db_latency_ms INTEGER,
  p99_db_latency_ms INTEGER,
  
  -- Webhook Latency
  avg_webhook_latency_ms NUMERIC(10,2),
  p50_webhook_latency_ms INTEGER,
  p95_webhook_latency_ms INTEGER,
  
  -- Resource Usage (if available from monitoring)
  avg_memory_usage_mb NUMERIC(10,2),
  max_memory_usage_mb INTEGER,
  avg_cpu_usage_percent NUMERIC(5,2),
  max_cpu_usage_percent NUMERIC(5,2),
  
  -- Queue Metrics
  avg_queue_size INTEGER,
  max_queue_size INTEGER,
  avg_queue_wait_time_ms NUMERIC(10,2),
  
  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_performance_metrics_period ON public.performance_metrics(period_start, period_end, period_type);
CREATE INDEX IF NOT EXISTS idx_performance_metrics_created_at ON public.performance_metrics(created_at DESC);

-- ─── 5. Contact Growth Metrics Table ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.contact_growth_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Period
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  period_type TEXT NOT NULL, -- 'daily', 'weekly', 'monthly'
  
  -- Contact Counts
  total_contacts INTEGER NOT NULL DEFAULT 0,
  new_contacts INTEGER NOT NULL DEFAULT 0,
  active_contacts INTEGER NOT NULL DEFAULT 0,
  inactive_contacts INTEGER NOT NULL DEFAULT 0,
  
  -- Contact Source Breakdown
  contacts_by_source JSONB, -- {"website": 100, "import": 50, "manual": 10}
  
  -- Growth Rate
  growth_rate NUMERIC(5,2),
  
  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_growth_metrics_period ON public.contact_growth_metrics(period_start, period_end, period_type);
CREATE INDEX IF NOT EXISTS idx_contact_growth_metrics_created_at ON public.contact_growth_metrics(created_at DESC);

-- ─── 6. Order Sync Trend Metrics Table ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.order_sync_trend_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Period
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  period_type TEXT NOT NULL, -- 'daily', 'weekly', 'monthly'
  
  -- Order Counts
  total_orders_synced INTEGER NOT NULL DEFAULT 0,
  new_orders INTEGER NOT NULL DEFAULT 0,
  updated_orders INTEGER NOT NULL DEFAULT 0,
  
  -- Order Value
  total_order_value NUMERIC(15,2),
  avg_order_value NUMERIC(10,2),
  
  -- Order Status Breakdown
  orders_by_status JSONB, -- {"pending": 10, "completed": 50, "cancelled": 2}
  
  -- Sync Trend
  sync_trend TEXT, -- 'increasing', 'decreasing', 'stable'
  trend_percentage NUMERIC(5,2),
  
  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_order_sync_trend_metrics_period ON public.order_sync_trend_metrics(period_start, period_end, period_type);
CREATE INDEX IF NOT EXISTS idx_order_sync_trend_metrics_created_at ON public.order_sync_trend_metrics(created_at DESC);

-- ─── 7. Row Level Security ─────────────────────────────────────────────
ALTER TABLE public.request_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_growth_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_sync_trend_metrics ENABLE ROW LEVEL SECURITY;

-- Service role has full access
GRANT ALL ON public.request_metrics TO service_role;
GRANT ALL ON public.sync_metrics TO service_role;
GRANT ALL ON public.webhook_metrics TO service_role;
GRANT ALL ON public.performance_metrics TO service_role;
GRANT ALL ON public.contact_growth_metrics TO service_role;
GRANT ALL ON public.order_sync_trend_metrics TO service_role;

-- Authenticated users can view metrics (read-only)
CREATE POLICY "Users can view request metrics"
  ON public.request_metrics FOR SELECT
  USING (true);

CREATE POLICY "Users can view sync metrics"
  ON public.sync_metrics FOR SELECT
  USING (true);

CREATE POLICY "Users can view webhook metrics"
  ON public.webhook_metrics FOR SELECT
  USING (true);

CREATE POLICY "Users can view performance metrics"
  ON public.performance_metrics FOR SELECT
  USING (true);

CREATE POLICY "Users can view contact growth metrics"
  ON public.contact_growth_metrics FOR SELECT
  USING (true);

CREATE POLICY "Users can view order sync trend metrics"
  ON public.order_sync_trend_metrics FOR SELECT
  USING (true);

-- ─── 8. Helper Function: Aggregate Request Metrics ─────────────────
CREATE OR REPLACE FUNCTION public.aggregate_request_metrics(p_period_type TEXT DEFAULT 'daily')
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_period_start TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ;
  v_total_requests INTEGER;
  v_successful_requests INTEGER;
  v_failed_requests INTEGER;
  v_avg_response_time NUMERIC(10,2);
  v_error_rate NUMERIC(5,2);
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
  
  -- Calculate metrics from api_key_usage_logs
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE status_code >= 200 AND status_code < 300),
    COUNT(*) FILTER (WHERE status_code >= 400),
    AVG(response_time_ms),
    (COUNT(*) FILTER (WHERE status_code >= 400)::NUMERIC / NULLIF(COUNT(*), 0)) * 100
  INTO 
    v_total_requests, v_successful_requests, v_failed_requests,
    v_avg_response_time, v_error_rate
  FROM public.api_key_usage_logs
  WHERE created_at >= v_period_start AND created_at < v_period_end;
  
  -- Upsert metrics
  INSERT INTO public.request_metrics (
    period_start, period_end, period_type,
    total_requests, successful_requests, failed_requests,
    avg_response_time_ms, error_rate
  ) VALUES (
    v_period_start, v_period_end, p_period_type,
    v_total_requests, v_successful_requests, v_failed_requests,
    v_avg_response_time, v_error_rate
  )
  ON CONFLICT (period_start, period_end, period_type) DO UPDATE SET
    total_requests = EXCLUDED.total_requests,
    successful_requests = EXCLUDED.successful_requests,
    failed_requests = EXCLUDED.failed_requests,
    avg_response_time_ms = EXCLUDED.avg_response_time_ms,
    error_rate = EXCLUDED.error_rate,
    updated_at = now();
END;
$$;

-- ─── 9. Helper Function: Aggregate Sync Metrics ───────────────────
CREATE OR REPLACE FUNCTION public.aggregate_sync_metrics(p_period_type TEXT DEFAULT 'daily')
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_period_start TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ;
  v_total_syncs INTEGER;
  v_successful_syncs INTEGER;
  v_failed_syncs INTEGER;
  v_avg_duration NUMERIC(10,2);
  v_sync_success_rate NUMERIC(5,2);
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
  
  -- Calculate metrics from website_sync_log
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'success'),
    COUNT(*) FILTER (WHERE status = 'failed'),
    AVG(duration_ms),
    (COUNT(*) FILTER (WHERE status = 'success')::NUMERIC / NULLIF(COUNT(*), 0)) * 100
  INTO 
    v_total_syncs, v_successful_syncs, v_failed_syncs,
    v_avg_duration, v_sync_success_rate
  FROM public.website_sync_log
  WHERE created_at >= v_period_start AND created_at < v_period_end;
  
  -- Upsert metrics
  INSERT INTO public.sync_metrics (
    period_start, period_end, period_type,
    total_syncs, successful_syncs, failed_syncs,
    avg_sync_duration_ms, sync_success_rate
  ) VALUES (
    v_period_start, v_period_end, p_period_type,
    v_total_syncs, v_successful_syncs, v_failed_syncs,
    v_avg_duration, v_sync_success_rate
  )
  ON CONFLICT (period_start, period_end, period_type) DO UPDATE SET
    total_syncs = EXCLUDED.total_syncs,
    successful_syncs = EXCLUDED.successful_syncs,
    failed_syncs = EXCLUDED.failed_syncs,
    avg_sync_duration_ms = EXCLUDED.avg_sync_duration_ms,
    sync_success_rate = EXCLUDED.sync_success_rate,
    updated_at = now();
END;
$$;

-- ─── 10. Helper Function: Aggregate Webhook Metrics ─────────────────
CREATE OR REPLACE FUNCTION public.aggregate_webhook_metrics(p_period_type TEXT DEFAULT 'daily')
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_period_start TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ;
  v_total_deliveries INTEGER;
  v_successful_deliveries INTEGER;
  v_failed_deliveries INTEGER;
  v_avg_delivery_time NUMERIC(10,2);
  v_delivery_success_rate NUMERIC(5,2);
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
  
  -- Calculate metrics from website_webhook_deliveries
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'delivered'),
    COUNT(*) FILTER (WHERE status = 'failed'),
    AVG(duration_ms),
    (COUNT(*) FILTER (WHERE status = 'delivered')::NUMERIC / NULLIF(COUNT(*), 0)) * 100
  INTO 
    v_total_deliveries, v_successful_deliveries, v_failed_deliveries,
    v_avg_delivery_time, v_delivery_success_rate
  FROM public.website_webhook_deliveries
  WHERE created_at >= v_period_start AND created_at < v_period_end;
  
  -- Upsert metrics
  INSERT INTO public.webhook_metrics (
    period_start, period_end, period_type,
    total_deliveries, successful_deliveries, failed_deliveries,
    avg_delivery_time_ms, delivery_success_rate
  ) VALUES (
    v_period_start, v_period_end, p_period_type,
    v_total_deliveries, v_successful_deliveries, v_failed_deliveries,
    v_avg_delivery_time, v_delivery_success_rate
  )
  ON CONFLICT (period_start, period_end, period_type) DO UPDATE SET
    total_deliveries = EXCLUDED.total_deliveries,
    successful_deliveries = EXCLUDED.successful_deliveries,
    failed_deliveries = EXCLUDED.failed_deliveries,
    avg_delivery_time_ms = EXCLUDED.avg_delivery_time_ms,
    delivery_success_rate = EXCLUDED.delivery_success_rate,
    updated_at = now();
END;
$$;
