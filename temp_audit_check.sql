-- Check audit logs categories
SELECT 
  action_category,
  COUNT(*) as count
FROM audit_logs
GROUP BY action_category
ORDER BY count DESC;
