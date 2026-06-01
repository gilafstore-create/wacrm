-- ============================================================
-- Patch: Fix partial security_events table from failed 023 run
-- Run this FIRST, then run 023_security_center.sql again
-- ============================================================

-- Drop the partially-created table (no data in it yet, safe to drop)
DROP TABLE IF EXISTS public.security_events CASCADE;

-- Also drop related tables if they were partially created
DROP TABLE IF EXISTS public.security_metrics CASCADE;
DROP TABLE IF EXISTS public.ip_blacklist CASCADE;

-- Drop functions that depend on them (will be re-created by 023)
DROP FUNCTION IF EXISTS public.calculate_security_score(UUID);
DROP FUNCTION IF EXISTS public.is_ip_blacklisted(TEXT);
DROP FUNCTION IF EXISTS public.log_security_event(TEXT, TEXT, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT);
