-- ============================================================
-- Migration 030: Fix audit trigger null action_type crash
-- ============================================================
-- Root cause: trigger_audit_api_key_actions fires on ANY UPDATE
-- to api_keys, including FK CASCADE SET NULL from website_integrations
-- delete. When only integration_id changes, none of the IF branches
-- set v_action_type, leaving it NULL → violates NOT NULL on audit_logs.
--
-- Two bugs fixed:
-- 1. UPDATE branch: default v_action_type to 'api_key_updated' so
--    CASCADE-only updates (integration_id → NULL) never produce NULL.
-- 2. DELETE branch: was using NEW.user_id / NEW.id / NEW.key_name
--    (all NULL in a DELETE trigger) — now uses OLD.* correctly.
-- 3. All column comparisons changed to IS DISTINCT FROM so NULL-safe.
-- ============================================================

CREATE OR REPLACE FUNCTION public.audit_api_key_action_wrapper()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_action_type    TEXT;
  v_action_category TEXT := 'api_keys';
  v_previous_state JSONB;
  v_new_state      JSONB;
  v_changed_fields TEXT[] := ARRAY[]::TEXT[];
  v_user_id        UUID;
  v_key_id         UUID;
  v_key_name       TEXT;
BEGIN

  IF TG_OP = 'INSERT' THEN
    v_action_type := 'api_key_created';
    v_new_state   := to_jsonb(NEW);
    v_user_id     := NEW.user_id;
    v_key_id      := NEW.id;
    v_key_name    := NEW.key_name;

  ELSIF TG_OP = 'UPDATE' THEN
    -- ── Default: always have a valid action_type ─────────────────────
    -- Prevents NULL when only non-tracked columns change (e.g. integration_id
    -- being set to NULL by ON DELETE SET NULL cascade from website_integrations).
    v_action_type    := 'api_key_updated';
    v_previous_state := to_jsonb(OLD);
    v_new_state      := to_jsonb(NEW);
    v_user_id        := NEW.user_id;
    v_key_id         := NEW.id;
    v_key_name       := NEW.key_name;

    -- IS DISTINCT FROM is NULL-safe (unlike !=)
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      IF NEW.status = 'revoked' THEN
        v_action_type := 'api_key_revoked';
      ELSIF NEW.status = 'disabled' THEN
        v_action_type := 'api_key_disabled';
      ELSIF NEW.status = 'active' THEN
        v_action_type := 'api_key_enabled';
      ELSE
        v_action_type := 'api_key_updated';
      END IF;
      v_changed_fields := v_changed_fields || 'status';
    END IF;

    IF OLD.key_hash IS DISTINCT FROM NEW.key_hash THEN
      v_action_type    := 'api_key_regenerated';
      v_changed_fields := v_changed_fields || 'key_hash';
    END IF;

    IF OLD.scope IS DISTINCT FROM NEW.scope THEN
      v_action_type    := 'api_key_permissions_changed';
      v_changed_fields := v_changed_fields || 'scope';
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    -- ── Use OLD.* — NEW is NULL in a DELETE trigger ──────────────────
    v_action_type    := 'api_key_deleted';
    v_previous_state := to_jsonb(OLD);
    v_user_id        := OLD.user_id;
    v_key_id         := OLD.id;
    v_key_name       := OLD.key_name;
  END IF;

  -- Insert audit row (action_type is now always non-NULL)
  INSERT INTO public.audit_logs (
    user_id, action_type, action_category,
    target_type, target_id, target_name,
    previous_state, new_state, changed_fields,
    description, success
  ) VALUES (
    v_user_id, v_action_type, v_action_category,
    'api_key', v_key_id, v_key_name,
    v_previous_state, v_new_state, v_changed_fields,
    'API key ' || v_action_type, true
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
