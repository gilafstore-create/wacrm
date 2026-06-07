/**
 * Server-side audit writer for the Integration Audit Center.
 *
 * The `audit_logs` table + GET /api/audit/logs already exist; this fills the
 * gap where no server action actually wrote rows (only API-key creation did),
 * which left the Sync / Webhooks / Integrations tabs empty.
 *
 * writeAudit never throws — auditing must not break the primary operation.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type AuditCategory =
  | 'api_keys'
  | 'webhooks'
  | 'sync'
  | 'integrations'
  | 'settings'
  | 'auth'
  | 'security'

export interface AuditEntry {
  userId: string
  actionType: string
  actionCategory: AuditCategory
  targetType?: string | null
  targetId?: string | null
  targetName?: string | null
  description?: string | null
  success?: boolean
  errorMessage?: string | null
  endpoint?: string | null
  method?: string | null
  ipAddress?: string | null
  tags?: string[] | null
}

export async function writeAudit(admin: SupabaseClient, e: AuditEntry): Promise<void> {
  try {
    await admin.from('audit_logs').insert({
      user_id:         e.userId,
      action_type:     e.actionType,
      action_category: e.actionCategory,
      target_type:     e.targetType ?? null,
      target_id:       e.targetId ?? null,
      target_name:     e.targetName ?? null,
      description:     e.description ?? null,
      success:         e.success ?? true,
      error_message:   e.errorMessage ?? null,
      endpoint:        e.endpoint ?? null,
      method:          e.method ?? null,
      ip_address:      e.ipAddress ?? null,
      tags:            e.tags ?? null,
    })
  } catch {
    // Auditing is best-effort; never break the caller.
  }
}
