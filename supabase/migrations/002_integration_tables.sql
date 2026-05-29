-- Integration tables for GilafStore ↔ WACRM communication
-- Run this in Supabase SQL Editor

-- 1. API Keys for GilafStore authentication
CREATE TABLE IF NOT EXISTS public.integration_keys (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    key_name TEXT NOT NULL,
    api_key TEXT NOT NULL UNIQUE,
    api_secret TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    permissions JSONB DEFAULT '["*"]'::jsonb,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Webhook logs for incoming/outgoing events
CREATE TABLE IF NOT EXISTS public.integration_webhook_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    direction TEXT NOT NULL DEFAULT 'incoming',
    event_type TEXT NOT NULL,
    payload JSONB,
    source TEXT DEFAULT 'gilafstore',
    status TEXT DEFAULT 'pending',
    response JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Message logs for tracking sent messages
CREATE TABLE IF NOT EXISTS public.integration_message_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    phone TEXT NOT NULL,
    template_name TEXT,
    message_text TEXT,
    variables JSONB,
    message_id TEXT,
    status TEXT DEFAULT 'pending',
    source TEXT DEFAULT 'gilafstore',
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_integration_keys_api_key ON public.integration_keys(api_key);
CREATE INDEX IF NOT EXISTS idx_integration_keys_active ON public.integration_keys(is_active);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_event ON public.integration_webhook_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created ON public.integration_webhook_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_message_logs_phone ON public.integration_message_logs(phone);
CREATE INDEX IF NOT EXISTS idx_message_logs_created ON public.integration_message_logs(created_at);

-- Add source column to contacts if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contacts' AND column_name = 'source') THEN
        ALTER TABLE public.contacts ADD COLUMN source TEXT DEFAULT 'manual';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contacts' AND column_name = 'metadata') THEN
        ALTER TABLE public.contacts ADD COLUMN metadata JSONB;
    END IF;
END $$;

-- RLS policies for integration tables (service role bypasses RLS)
ALTER TABLE public.integration_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_message_logs ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (used by API routes)
CREATE POLICY "service_role_all_integration_keys" ON public.integration_keys
    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_webhook_logs" ON public.integration_webhook_logs
    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_message_logs" ON public.integration_message_logs
    FOR ALL USING (true) WITH CHECK (true);

-- Grant access
GRANT ALL ON public.integration_keys TO service_role;
GRANT ALL ON public.integration_webhook_logs TO service_role;
GRANT ALL ON public.integration_message_logs TO service_role;
GRANT SELECT ON public.integration_keys TO authenticated;
GRANT SELECT ON public.integration_webhook_logs TO authenticated;
GRANT SELECT ON public.integration_message_logs TO authenticated;

-- Seed a default integration key (matching GilafStore's generated key pattern)
-- This will be regenerated from the admin panel
INSERT INTO public.integration_keys (key_name, api_key, api_secret, permissions)
VALUES (
    'GilafStore Default',
    'gcrm_' || encode(gen_random_bytes(24), 'hex'),
    encode(gen_random_bytes(32), 'hex'),
    '["*"]'::jsonb
) ON CONFLICT DO NOTHING;
