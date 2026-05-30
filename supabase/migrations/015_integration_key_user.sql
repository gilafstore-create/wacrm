-- ============================================================
-- Migration 015: Link integration_keys to a specific CRM user
-- Author: Phase 1 Security Fix — ISSUE-003
-- Date:   2026-05-30
-- ============================================================
-- PROBLEM:
--   All 4 integration API routes called profiles.limit(1).single()
--   to resolve the CRM account owner. This picks whichever user
--   was created first — wrong in any multi-user CRM deployment and
--   a data-isolation vulnerability.
--
-- SOLUTION:
--   Add user_id column to integration_keys so each API key is
--   explicitly bound to exactly one CRM account (auth.users row).
--   All API routes then read ownerUserId from keyRecord.user_id
--   instead of querying profiles at all.
--
-- BACKFILL:
--   Existing rows are assigned the earliest-created profile's user_id.
--   On this deployment: 1 user (gilafstore@gmail.com, id 533db055-...)
--   so the backfill is unambiguous.
--
-- SAFE:   Idempotent — ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
-- ROLLBACK: DROP COLUMN IF EXISTS user_id (see rollback_report.md).
-- ============================================================

-- Step 1: Add user_id column (nullable first to allow backfill)
ALTER TABLE public.integration_keys
  ADD COLUMN IF NOT EXISTS user_id UUID
    REFERENCES auth.users(id) ON DELETE CASCADE;

-- Step 2: Backfill all existing rows with the earliest-created profile
-- (On this system: 1 profile — gilafstore@gmail.com — so no ambiguity)
UPDATE public.integration_keys
SET user_id = (
  SELECT user_id
  FROM   public.profiles
  ORDER  BY created_at ASC
  LIMIT  1
)
WHERE user_id IS NULL;

-- Step 3: Make column NOT NULL now that backfill is complete
ALTER TABLE public.integration_keys
  ALTER COLUMN user_id SET NOT NULL;

-- Step 4: Index for fast lookups by CRM owner
CREATE INDEX IF NOT EXISTS idx_integration_keys_user_id
  ON public.integration_keys(user_id);

-- Step 5: RLS policy so authenticated users can only read their own keys
ALTER TABLE public.integration_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own integration keys" ON public.integration_keys;
CREATE POLICY "Users see own integration keys"
  ON public.integration_keys
  FOR SELECT
  USING (auth.uid() = user_id);

-- Verification (run separately after migration):
-- SELECT id, key_name, user_id FROM public.integration_keys;
-- Expected: all rows have non-null user_id = 533db055-4cdb-4e93-a7e6-02d914e61e35
