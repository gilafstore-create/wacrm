/**
 * GET /api/integration/health
 * POST /api/integration/health  (authenticated)
 *
 * Public: basic health check
 * Authenticated (API key): full diagnostic status
 */
import { NextRequest, NextResponse } from 'next/server'
import { validateApiKey, applyRateLimit, supabaseAdmin, getClientIP } from '@/lib/integration/middleware'

export async function GET() {
  const supabaseConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY

  return NextResponse.json({
    success: true,
    service: 'WACRM',
    status: 'healthy',
    version: process.env.npm_package_version ?? 'unknown',
    database: supabaseConfigured ? 'configured' : 'not_configured',
    render: !!process.env.RENDER,
    timestamp: new Date().toISOString(),
  }, { status: 200 })
}

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('X-GilafStore-Key') ?? ''
  const ip = getClientIP(request)

  if (!apiKey) return GET()

  // Rate limit
  const limited = await applyRateLimit(request, apiKey, 'health')
  if (limited) return limited

  const { record, error } = await validateApiKey(apiKey)
  if (error || !record) {
    return NextResponse.json({ error: error ?? 'Invalid key' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  let dbStatus = 'unknown'
  let waStatus = 'unknown'
  let queuePending = 0

  try {
    // DB check
    const { error: dbErr } = await admin.from('integration_keys').select('id').eq('id', record.id).maybeSingle()
    dbStatus = dbErr ? `error: ${dbErr.message}` : 'connected'

    // WA config check
    const { data: waConfig } = await admin
      .from('whatsapp_config')
      .select('phone_number_id, is_active')
      .eq('user_id', record.user_id)
      .maybeSingle()
    waStatus = waConfig?.is_active ? 'configured' : 'not_configured'

    // Queue stats
    const { count } = await admin
      .from('integration_webhook_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', record.user_id)
      .eq('status', 'received')
    queuePending = count ?? 0

  } catch (err) {
    dbStatus = `exception: ${err instanceof Error ? err.message : 'unknown'}`
  }

  // Log heartbeat — fire-and-forget .then() ensures dispatch (Supabase builders are thenables, void never calls .then())
  admin.from('heartbeat_logs').insert({
    user_id: record.user_id,
    status: 'ok',
    latency_ms: 0,
    render_online: true,
    db_online: dbStatus === 'connected',
    wa_online: waStatus === 'configured',
  }).then(() => {}, () => {})

  // Update heartbeat on any matching website_integrations for this user — fire-and-forget .then() ensures dispatch
  admin.from('website_integrations').update({
    last_heartbeat_at:    new Date().toISOString(),
    heartbeat_latency_ms: 0,
    heartbeat_enabled:    true,
  }).eq('user_id', record.user_id).eq('status', 'active').then(() => {}, () => {})

  return NextResponse.json({
    success: true,
    service: 'WACRM',
    status: 'healthy',
    database: dbStatus,
    whatsapp: waStatus,
    api_key_valid: true,
    user_id: record.user_id,
    queue_pending: queuePending,
    render: !!process.env.RENDER,
    timestamp: new Date().toISOString(),
  }, { status: 200 })
}
