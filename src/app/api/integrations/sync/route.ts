/**
 * POST /api/integrations/sync
 * Trigger a manual sync for a website integration
 * Body: { id: string, entity_type?: 'contacts'|'orders'|'all' }
 *
 * POST /api/integrations/sync?action=retry-webhook
 * Retry a failed webhook delivery
 * Body: { delivery_id: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function getUser() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// ── Deliver a webhook to a website ───────────────────────────────────────────
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
    const latency = Date.now() - start
    let respBody = ''
    try { respBody = await res.text() } catch { /* ignore */ }
    return { ok: res.ok, status: res.status, latency, body: respBody.slice(0, 500), error: null }
  } catch (err: unknown) {
    clearTimeout(timer)
    return {
      ok: false, status: 0, latency: Date.now() - start,
      body: '', error: (err as Error).message,
    }
  }
}

export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')
  const body = await request.json()
  const admin = adminClient()

  // ── Retry a failed webhook delivery ────────────────────────────────────────
  if (action === 'retry-webhook') {
    const { delivery_id } = body
    if (!delivery_id) return NextResponse.json({ error: 'delivery_id required' }, { status: 400 })

    const { data: delivery } = await admin
      .from('website_webhook_deliveries')
      .select('*, website_integrations(webhook_url, webhook_secret, website_api_key)')
      .eq('id', delivery_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!delivery) return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })

    const intg = (delivery as Record<string, unknown>).website_integrations as Record<string, unknown>
    if (!intg?.webhook_url) return NextResponse.json({ error: 'No webhook URL configured' }, { status: 400 })

    const result = await deliverWebhook(
      String(intg.webhook_url),
      String(intg.webhook_secret ?? ''),
      String((delivery as Record<string, unknown>).event_type),
      (delivery as Record<string, unknown>).payload as Record<string, unknown> ?? {},
      String(intg.website_api_key ?? ''),
    )

    await admin.from('website_webhook_deliveries').update({
      http_status:   result.status,
      response_body: result.body,
      duration_ms:   result.latency,
      status:        result.ok ? 'delivered' : 'failed',
      attempt:       ((delivery as Record<string, unknown>).attempt as number ?? 1) + 1,
      completed_at:  new Date().toISOString(),
      error_message: result.error,
    }).eq('id', delivery_id)

    return NextResponse.json({ success: result.ok, result })
  }

  // ── Manual sync ─────────────────────────────────────────────────────────────
  const { id: integrationId, entity_type = 'all' } = body
  if (!integrationId) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Get integration record
  const { data: intg } = await admin
    .from('website_integrations')
    .select('*')
    .eq('id', integrationId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!intg) return NextResponse.json({ error: 'Integration not found' }, { status: 404 })

  // Create sync log entry
  const { data: syncLog } = await admin.from('website_sync_log').insert({
    integration_id: integrationId,
    user_id:        user.id,
    sync_type:      'manual',
    entity_type,
    status:         'running',
  }).select('id').maybeSingle()

  const syncId = syncLog?.id

  // Attempt to fetch from website (GilafStore standard endpoints)
  let synced = 0
  let failed = 0
  let syncError: string | null = null

  try {
    const base = intg.website_url
    const apiKey = intg.website_api_key

    if (entity_type === 'contacts' || entity_type === 'all') {
      // Try GilafStore customer sync endpoint
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
          // Upsert each customer into contacts
          for (const c of customers.slice(0, 500)) {
            const customer = c as Record<string, unknown>
            try {
              await admin.from('contacts').upsert({
                user_id:     user.id,
                name:        String(customer.name ?? customer.display_name ?? 'Unknown'),
                phone:       String(customer.phone ?? customer.billing_phone ?? ''),
                email:       String(customer.email ?? ''),
                external_id: String(customer.id ?? ''),
              }, { onConflict: 'user_id,external_id', ignoreDuplicates: false })
              synced++
            } catch { failed++ }
          }
        }
      }
    }
  } catch (err: unknown) {
    syncError = (err as Error).message
  }

  // Update sync log
  await admin.from('website_sync_log').update({
    records_synced: synced,
    records_failed: failed,
    status:         syncError ? 'failed' : 'completed',
    error_message:  syncError,
    completed_at:   new Date().toISOString(),
  }).eq('id', syncId)

  // Update integration last_sync_at
  await admin.from('website_integrations').update({
    last_sync_at:           new Date().toISOString(),
    total_synced_contacts:  intg.total_synced_contacts + synced,
  }).eq('id', integrationId)

  return NextResponse.json({
    success: !syncError,
    sync_id: syncId,
    synced,
    failed,
    error: syncError,
    entity_type,
  })
}

// ── GET: webhook deliveries for an integration ────────────────────────────────
export async function GET(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const integrationId = searchParams.get('integration_id')

  const admin = adminClient()

  if (integrationId) {
    const { data } = await admin
      .from('website_webhook_deliveries')
      .select('id, event_type, http_status, duration_ms, status, attempt, error_message, created_at, completed_at')
      .eq('integration_id', integrationId)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
    return NextResponse.json({ deliveries: data ?? [] })
  }

  // Sync logs
  const { data: logs } = await admin
    .from('website_sync_log')
    .select('*')
    .eq('user_id', user.id)
    .order('started_at', { ascending: false })
    .limit(20)

  return NextResponse.json({ sync_logs: logs ?? [] })
}
