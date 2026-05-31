-- ============================================================
-- 020_grant_service_role_privileges.sql
-- ============================================================
-- ROOT CAUSE FIX — inbound WhatsApp messages were silently dropped.
--
-- The webhook handler uses the service_role key (supabaseAdmin()).
-- processMessage()'s first DB call is a SELECT on `contacts` inside
-- findOrCreateContact(). On this instance service_role had NO
-- table-level privileges on contacts / conversations / messages, so
-- that SELECT failed with:
--
--   42501  permission denied for table contacts
--
-- findOrCreateContact() then returned null and processMessage()
-- aborted before inserting anything — so no conversation, no message,
-- no dashboard activity ever appeared, even though Meta WAS delivering
-- the webhook and the HMAC signature verified correctly.
--
-- Migration 001 only ever granted whatsapp_config explicitly; every
-- other table relied on Supabase default grants that were missing here.
--
-- service_role is the trusted server-side role and bypasses RLS by
-- design. Restoring full DML on the public schema is the intended
-- Supabase default and unblocks the entire inbound pipeline.
--
-- Idempotent and safe to re-run.
-- ============================================================

GRANT USAGE  ON SCHEMA public TO service_role;
GRANT ALL    ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL    ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Future tables/sequences created by later migrations inherit the
-- grant so this class of bug cannot recur.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
