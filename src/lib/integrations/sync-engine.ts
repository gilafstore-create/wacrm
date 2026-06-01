/**
 * Website integration sync engine.
 *
 * Single source of truth for "pull data from a connected website into
 * the CRM". Used by BOTH the manual Sync Now button
 * (`/api/integrations/sync`) and the background scheduler
 * (`/lib/integrations/scheduler` + `/api/cron/sync`), so manual and
 * automatic syncs behave identically.
 *
 * The logic here was extracted verbatim from the original manual sync
 * route — same endpoints, same upsert shape, same webhook dispatch —
 * to guarantee zero behavioral drift.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export function syncAdminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export type EntityType = 'contacts' | 'orders' | 'all'
export type SyncType = 'manual' | 'auto' | 'initial'

export interface IntegrationRow {
  id: string
  user_id: string
  website_url: string
  website_api_key: string
  webhook_url: string | null
  webhook_secret: string | null
  total_synced_contacts: number | null
  total_webhooks_sent: number | null
  total_webhooks_failed: number | null
}

export interface SyncResult {
  syncId: string | null
  synced: number
  failed: number
  error: string | null
  durationMs: number
  entityType: EntityType
}

// ── Deliver a signed webhook to the website ──────────────────────────────────
async function deliverWebhook(
  webhookUrl: string,
  secret: string,
  event: string,
  payload: Record<string, unknown>,
  apiKey?: string,
) {
  const body = JSON.stringify({ event, data: payload, timestamp: Math.floor(Date.now() / 1000) })
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  const start = Date.now()

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-WACRM-Signature': sig,
        'X-WACRM-Event': event,
        'X-WACRM-Timestamp': String(Math.floor(Date.now() / 1000)),
        ...(apiKey ? { 'X-WACRM-Key': apiKey } : {}),
      },
      body,
    })
    clearTimeout(timer)
    let respBody = ''
    try { respBody = await res.text() } catch { /* ignore */ }
    return { ok: res.ok, status: res.status, latency: Date.now() - start, body: respBody.slice(0, 500), error: null as string | null }
  } catch (err: unknown) {
    clearTimeout(timer)
    return { ok: false, status: 0, latency: Date.now() - start, body: '', error: (err as Error).message }
  }
}

/**
 * Run one sync for a single integration. Writes a `website_sync_log`
 * row, upserts pulled contacts, updates the integration's sync state
 * + counters, and dispatches the sync.completed / sync.failed webhook.
 *
 * Never throws — all failures are captured into the returned SyncResult
 * and persisted, so the scheduler loop can't be broken by one bad site.
 */
export async function runIntegrationSync(
  admin: SupabaseClient,
  intg: IntegrationRow,
  opts: { syncType: SyncType; entityType?: EntityType },
): Promise<SyncResult> {
  const entityType: EntityType = opts.entityType ?? 'all'
  const startedAt = Date.now()

  // Create sync log entry (status=running)
  const { data: syncLog } = await admin.from('website_sync_log').insert({
    integration_id: intg.id,
    user_id:        intg.user_id,
    sync_type:      opts.syncType,
    entity_type:    entityType,
    status:         'running',
  }).select('id').maybeSingle()
  const syncId: string | null = syncLog?.id ?? null

  let synced = 0
  let failed = 0
  let syncError: string | null = null

  try {
    const base = intg.website_url
    const apiKey = intg.website_api_key

    if (entityType === 'contacts' || entityType === 'all') {
      const res = await fetch(`${base}/api/crm/customers?limit=100`, {
        headers: { 'X-GilafStore-Key': apiKey, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null)

      if (res?.ok) {
        const data: unknown = await res.json().catch(() => null)
        const customers = Array.isArray(data)
          ? data
          : (data as Record<string, unknown>)?.customers as unknown[]
        if (Array.isArray(customers)) {
          for (const c of customers.slice(0, 500)) {
            const customer = c as Record<string, unknown>
            try {
              await admin.from('contacts').upsert({
                user_id:     intg.user_id,
                name:        String(customer.name ?? customer.display_name ?? 'Unknown'),
                phone:       String(customer.phone ?? customer.billing_phone ?? ''),
                email:       String(customer.email ?? ''),
                external_id: String(customer.id ?? ''),
              }, { onConflict: 'user_id,external_id', ignoreDuplicates: false })
              synced++
            } catch { failed++ }
          }
        }
      } else if (res) {
        syncError = `Website returned HTTP ${res.status} from /api/crm/customers`
      } else {
        syncError = 'Website unreachable (request failed or timed out)'
      }
    }
  } catch (err: unknown) {
    syncError = (err as Error).message
  }

  const durationMs = Date.now() - startedAt

  // Update sync log
  if (syncId) {
    await admin.from('website_sync_log').update({
      records_synced: synced,
      records_failed: failed,
      duration_ms:    durationMs,
      status:         syncError ? 'failed' : 'completed',
      error_message:  syncError,
      completed_at:   new Date().toISOString(),
    }).eq('id', syncId)
  }

  // Update integration last_sync_at + counters
  await admin.from('website_integrations').update({
    last_sync_at:          new Date().toISOString(),
    total_synced_contacts: (intg.total_synced_contacts ?? 0) + synced,
  }).eq('id', intg.id)

  // Dispatch webhook to the website
  if (intg.webhook_url) {
    const webhookPayload = {
      sync_id:        syncId,
      entity_type:    entityType,
      synced,
      failed,
      total_contacts: (intg.total_synced_contacts ?? 0) + synced,
      error:          syncError,
    }

    const { data: delivery } = await admin.from('website_webhook_deliveries').insert({
      integration_id: intg.id,
      user_id:        intg.user_id,
      event_type:     syncError ? 'sync.failed' : 'sync.completed',
      payload:        webhookPayload,
      status:         'pending',
      attempt:        1,
    }).select('id').maybeSingle()

    const webhookResult = await deliverWebhook(
      intg.webhook_url,
      intg.webhook_secret ?? '',
      syncError ? 'sync.failed' : 'sync.completed',
      webhookPayload,
      intg.website_api_key ?? '',
    )

    if (delivery) {
      await admin.from('website_webhook_deliveries').update({
        http_status:   webhookResult.status,
        response_body: webhookResult.body,
        duration_ms:   webhookResult.latency,
        status:        webhookResult.ok ? 'delivered' : 'failed',
        completed_at:  new Date().toISOString(),
        error_message: webhookResult.error,
      }).eq('id', delivery.id)
    }

    const counterUpdate: Record<string, unknown> = {
      total_webhooks_sent: (intg.total_webhooks_sent ?? 0) + 1,
    }
    if (!webhookResult.ok) {
      counterUpdate.total_webhooks_failed = (intg.total_webhooks_failed ?? 0) + 1
    }
    await admin.from('website_integrations').update(counterUpdate).eq('id', intg.id)
  }

  return { syncId, synced, failed, error: syncError, durationMs, entityType }
}
