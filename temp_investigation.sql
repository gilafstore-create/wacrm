-- Investigation Query for Gilaf Store Integration
SELECT 
  id,
  website_name,
  auto_sync_enabled,
  sync_interval_min,
  next_sync_at,
  last_sync_at,
  last_sync_status,
  last_sync_error,
  consecutive_sync_failures,
  health_score,
  status,
  total_synced_contacts,
  total_synced_orders,
  total_webhooks_sent,
  total_webhooks_failed,
  last_heartbeat_at
FROM website_integrations
WHERE website_name = 'Gilaf Store';
