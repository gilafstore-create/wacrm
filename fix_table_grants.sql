-- ============================================================
-- FIX TABLE PRIVILEGES FOR SUPABASE AUTHENTICATED USERS
-- RLS policies are not enough; authenticated role also needs grants.
-- ============================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contacts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contact_tags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.custom_fields TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contact_custom_values TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contact_notes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.message_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pipelines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pipeline_stages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.deals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.broadcasts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.broadcast_recipients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.automations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.automation_logs TO authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
