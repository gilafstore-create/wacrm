-- ============================================================
-- Migration 018: Revenue Attribution, Segments, Quick Replies
-- ============================================================
-- ADDITIVE ONLY — safe to re-run.
-- ============================================================

-- ─── 1. Revenue Attribution ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.integration_revenue_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id      UUID        REFERENCES public.contacts(id) ON DELETE SET NULL,
  order_id        TEXT        NOT NULL,
  revenue         NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency        TEXT        NOT NULL DEFAULT 'INR',
  attributed_to   TEXT,       -- 'broadcast'|'automation'|'otp'|'manual'|'organic'
  attributed_id   UUID,       -- broadcast_id or automation_id
  phone           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ire_user_created ON public.integration_revenue_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ire_contact      ON public.integration_revenue_events(contact_id);
ALTER TABLE public.integration_revenue_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='integration_revenue_events' AND policyname='Users see own revenue') THEN
    CREATE POLICY "Users see own revenue" ON public.integration_revenue_events FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ─── 2. Customer Segments ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contact_segments (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  description   TEXT,
  rules         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  is_dynamic    BOOLEAN     NOT NULL DEFAULT true,
  contact_count INTEGER     NOT NULL DEFAULT 0,
  last_evaluated_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cs_user_id ON public.contact_segments(user_id);
ALTER TABLE public.contact_segments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contact_segments' AND policyname='Users manage own segments') THEN
    CREATE POLICY "Users manage own segments" ON public.contact_segments FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.contact_segment_members (
  segment_id    UUID        NOT NULL REFERENCES public.contact_segments(id) ON DELETE CASCADE,
  contact_id    UUID        NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (segment_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_csm_contact ON public.contact_segment_members(contact_id);

-- ─── 3. Quick Replies ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quick_replies (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category      TEXT        NOT NULL DEFAULT 'general', -- 'order'|'shipping'|'support'|'refund'|'welcome'|'general'
  title         TEXT        NOT NULL,
  message       TEXT        NOT NULL,
  shortcut      TEXT,        -- e.g. '/track' for quick trigger
  usage_count   INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qr_user_category ON public.quick_replies(user_id, category);
ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='quick_replies' AND policyname='Users manage own quick replies') THEN
    CREATE POLICY "Users manage own quick replies" ON public.quick_replies FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ─── 4. Queue Failures (dead letter queue) ───────────────────
CREATE TABLE IF NOT EXISTS public.integration_queue_failures (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type    TEXT        NOT NULL,
  payload       JSONB,
  attempts      INTEGER     NOT NULL DEFAULT 0,
  last_error    TEXT,
  last_attempt_at TIMESTAMPTZ,
  can_replay    BOOLEAN     NOT NULL DEFAULT true,
  replayed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_iqf_user_created ON public.integration_queue_failures(user_id, created_at DESC);
ALTER TABLE public.integration_queue_failures ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='integration_queue_failures' AND policyname='Users see own queue failures') THEN
    CREATE POLICY "Users see own queue failures" ON public.integration_queue_failures FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

-- ─── 5. Additive columns on broadcasts (scheduled) ───────────
ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

-- ─── 6. Additive column: conversation assignment ──────────────
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS assigned_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
