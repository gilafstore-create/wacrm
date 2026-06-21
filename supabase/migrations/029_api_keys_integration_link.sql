-- Migration: Link api_keys to website_integrations for master key unification
-- This allows a single API key to be shared between Integration Overview and API Keys tabs

-- Add integration_id column to api_keys table
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS integration_id uuid REFERENCES website_integrations(id) ON DELETE SET NULL;

-- Index for fast lookup by integration_id
CREATE INDEX IF NOT EXISTS idx_api_keys_integration_id ON api_keys(integration_id) WHERE integration_id IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN api_keys.integration_id IS 'Links this API key to a website integration (master key concept). NULL for standalone keys.';
