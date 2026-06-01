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
import { runIntegrationSync, type IntegrationRow } from '@/lib/integrations/sync-engine'

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

  // Delegate to the shared sync engine — identical code path to the
  // background scheduler, so manual and auto syncs behave the same.
  const result = await runIntegrationSync(admin, intg as IntegrationRow, {
    syncType: 'manual',
    entityType: entity_type,
  })

  // Mirror the scheduler's diagnostics fields for manual runs too.
  await admin.from('website_integrations').update({
    last_sync_attempt_at:      new Date().toISOString(),
    last_sync_status:          result.error ? 'failed' : 'success',
    last_sync_error:           result.error,
    last_sync_duration_ms:     result.durationMs,
    consecutive_sync_failures: result.error
      ? ((intg.consecutive_sync_failures ?? 0) + 1)
      : 0,
  }).eq('id', integrationId)

  return NextResponse.json({
    success: !result.error,
    sync_id: result.syncId,
    synced:  result.synced,
    failed:  result.failed,
    error:   result.error,
    entity_type: result.entityType,
  })
}

// ── GET: webhook deliveries / sync logs / diagnostics ─────────────────────────
export async function GET(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')
  const integrationId = searchParams.get('integration_id')

  const admin = adminClient()

  // ── Diagnostics: scheduler status ─────────────────────────────────────────
  if (action === 'diagnostics') {
    const { getLastTick, isLoopRunning } = await import('@/lib/integrations/scheduler')
    const lastTick = getLastTick()

    // Active sync jobs (integrations currently being synced)
    const { data: active } = await admin
      .from('website_sync_log')
      .select('id, integration_id, sync_type, entity_type, started_at')
      .eq('user_id', user.id)
      .eq('status', 'running')
      .order('started_at', { ascending: false })
      .limit(10)

    // Enabled integrations with their next_sync_at
    const { data: enabled } = await admin
      .from('website_integrations')
      .select('id, website_name, auto_sync_enabled, sync_interval_min, next_sync_at, last_sync_attempt_at, last_sync_status, consecutive_sync_failures')
      .eq('user_id', user.id)
      .eq('auto_sync_enabled', true)
      .order('next_sync_at', { ascending: true, nullsFirst: true })
      .limit(20)

    return NextResponse.json({
      scheduler_running:       isLoopRunning(),
      last_tick:               lastTick,
      active_sync_jobs:        active ?? [],
      enabled_integrations:    enabled ?? [],
      server_time:             new Date().toISOString(),
    })
  }

  // ── Webhook deliveries for a specific integration ─────────────────────────
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

  // ── Sync logs (default) ────────────────────────────────────────────────────
  const { data: logs } = await admin
    .from('website_sync_log')
    .select('*')
    .eq('user_id', user.id)
    .order('started_at', { ascending: false })
    .limit(20)

  return NextResponse.json({ sync_logs: logs ?? [] })
}
