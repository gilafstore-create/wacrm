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
import { writeAudit } from './audit'

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
  last_sync_at: string | null
  total_synced_contacts: number | null
  total_synced_orders: number | null
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
    const base = intg.website_url?.trim().replace(/\/$/, '')
    const apiKey = intg.website_api_key?.trim()

    // ── Pre-flight: abort immediately if key or URL is missing ──────────────────
    // This prevents 'reason: missing' events in the GilafStore security log.
    // The API key must be a non-empty string; an empty string means the
    // integration was created without a key (or the DB row has a null value).
    if (!apiKey) {
      syncError = 'Integration is missing website_api_key — configure a valid API key in Integration settings'
      console.error(
        `[sync-engine] integration=${intg.id} url=${base ?? '(empty)'} ` +
        `ABORT: website_api_key is missing or empty — cannot make authenticated requests to /api/crm/*. ` +
        `Set the key in the Integrations dashboard.`
      )
      // Write a specific audit event so this shows up clearly in the Audit Center
      await writeAudit(admin, {
        userId:         intg.user_id,
        actionType:     'sync_aborted_missing_key',
        actionCategory: 'sync',
        targetType:     'integration',
        targetId:       intg.id,
        targetName:     base ?? intg.website_url,
        description:    'Sync aborted: website_api_key is missing. Configure a valid API key.',
        success:        false,
        errorMessage:   syncError,
        endpoint:       `${base}/api/crm/*`,
        tags:           ['missing_api_key', opts.syncType],
      })
      // Skip all fetch calls — fall through to sync log update
      throw new Error(syncError)
    }

    if (!base) {
      syncError = 'Integration is missing website_url — configure the website URL in Integration settings'
      throw new Error(syncError)
    }

    if (entityType === 'contacts' || entityType === 'all') {
      // Use last_sync_at for incremental sync — prevents historical data loss
      const sinceParam = intg.last_sync_at
        ? `&since=${encodeURIComponent(intg.last_sync_at)}`
        : ''
      const res = await fetch(`${base}/api/crm/customers.php?limit=500${sinceParam}`, {
        headers: { 'X-GilafStore-Key': apiKey, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(30_000),
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
        // Surface the website's own error message so the real cause is visible
        // in the dashboard (e.g. IP whitelist / invalid key) without server logs.
        let detail = ''
        try {
          const errBody = await res.text()
          if (errBody) {
            try {
              const parsed = JSON.parse(errBody) as Record<string, unknown>
              detail = String(parsed.error ?? parsed.message ?? errBody)
            } catch {
              detail = errBody
            }
          }
        } catch { /* ignore */ }
        syncError = `Website returned HTTP ${res.status} from /api/crm/customers`
          + (detail ? ` — ${detail.slice(0, 200)}` : '')
      } else {
        syncError = 'Website unreachable (request failed or timed out)'
      }
    }

    // ── Orders sync ──────────────────────────────────────────────────────────
    if ((entityType === 'orders' || entityType === 'all') && !syncError) {
      // Use last_sync_at for incremental sync — prevents historical data loss
      const ordersSinceParam = intg.last_sync_at
        ? `&since=${encodeURIComponent(intg.last_sync_at)}`
        : ''
      const ordersRes = await fetch(`${base}/api/crm/orders.php?limit=500${ordersSinceParam}`, {
        headers: { 'X-GilafStore-Key': apiKey, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(30_000),
      }).catch(() => null)

      if (ordersRes?.ok) {
        const ordersData: unknown = await ordersRes.json().catch(() => null)
        const orders = Array.isArray(ordersData)
          ? ordersData
          : (ordersData as Record<string, unknown>)?.orders as unknown[]
        if (Array.isArray(orders)) {
          for (const o of orders.slice(0, 500)) {
            const order = o as Record<string, unknown>
            try {
              // Ensure contact exists for this order's customer
              const phone = String(order.customer_phone ?? '')
              const email = String(order.customer_email ?? '')
              const name = String(order.customer_name ?? 'Guest')
              const externalUserId = String(order.user_id ?? '')

              if (phone || email || externalUserId) {
                await admin.from('contacts').upsert({
                  user_id:     intg.user_id,
                  name,
                  phone:       phone || `order-${order.id}`,
                  email,
                  external_id: externalUserId || null,
                }, { onConflict: 'user_id,external_id', ignoreDuplicates: true })
              }

              synced++
            } catch { failed++ }
          }

          // Update order counter
          await admin.from('website_integrations').update({
            total_synced_orders: (intg.total_synced_orders ?? 0) + orders.length,
          }).eq('id', intg.id)
        }
      } else if (ordersRes) {
        // Non-fatal: orders endpoint may not exist yet on older sites
        console.warn(`[sync-engine] Orders endpoint returned HTTP ${ordersRes.status} — skipping orders`)
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

  // Update integration counters — only advance last_sync_at on success so failed
  // syncs never move the incremental cursor (which would cause 0-record recovery syncs)
  const integrationPatch: Record<string, unknown> = {
    total_synced_contacts: (intg.total_synced_contacts ?? 0) + synced,
  }
  if (!syncError) {
    integrationPatch.last_sync_at = new Date().toISOString()
  }
  await admin.from('website_integrations').update(integrationPatch).eq('id', intg.id)

  // Audit: record the sync outcome (Audit Center -> Sync tab)
  await writeAudit(admin, {
    userId:         intg.user_id,
    actionType:     syncError ? 'sync_failed' : 'sync_completed',
    actionCategory: 'sync',
    targetType:     'integration',
    targetId:       intg.id,
    targetName:     intg.website_url,
    description:    syncError
      ? `${opts.syncType} sync failed: ${syncError}`
      : `${opts.syncType} sync completed — ${synced} synced, ${failed} failed (${entityType})`,
    success:        !syncError,
    errorMessage:   syncError,
    endpoint:       `${intg.website_url}/api/crm/customers`,
    tags:           [opts.syncType, entityType],
  })

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

    // Audit: record the webhook delivery (Audit Center -> Webhooks tab)
    const whEvent = syncError ? 'sync.failed' : 'sync.completed'
    await writeAudit(admin, {
      userId:         intg.user_id,
      actionType:     webhookResult.ok ? 'webhook_delivered' : 'webhook_failed',
      actionCategory: 'webhooks',
      targetType:     'integration',
      targetId:       intg.id,
      targetName:     intg.webhook_url,
      description:    `Webhook ${whEvent} -> HTTP ${webhookResult.status} (${webhookResult.latency}ms)`,
      success:        webhookResult.ok,
      errorMessage:   webhookResult.error,
      endpoint:       intg.webhook_url,
      method:         'POST',
      tags:           [whEvent],
    })

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
