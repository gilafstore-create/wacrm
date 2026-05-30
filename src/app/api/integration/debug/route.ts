/**
 * GET /api/integration/debug
 * Returns full system diagnostic — requires valid API key
 * Never exposes secrets or full tokens
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { validateApiKey, applyRateLimit } from '@/lib/integration/middleware'

export async function GET(request: NextRequest) {
  try {
    const apiKey = request.headers.get('X-GilafStore-Key') ?? ''
    if (!apiKey) return NextResponse.json({ error: 'Missing API key' }, { status: 401 })

    const limited = await applyRateLimit(request, apiKey, 'debug')
    if (limited) return limited

    const { record: keyRecord, error: keyError } = await validateApiKey(apiKey)
    if (keyError || !keyRecord) {
      return NextResponse.json({ error: keyError ?? 'Invalid key' }, { status: 401 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin: any = supabaseAdmin()
    const userId = keyRecord.user_id

    const checks: Record<string, unknown> = {}

    // 1. Database connectivity
    try {
      const start = Date.now()
      await admin.from('integration_keys').select('id').eq('id', keyRecord.id).maybeSingle()
      checks.database = { status: 'connected', latency_ms: Date.now() - start }
    } catch (e) {
      checks.database = { status: 'error', error: e instanceof Error ? e.message : 'unknown' }
    }

    // 2. WhatsApp config
    try {
      const { data: waConfig } = await admin
        .from('whatsapp_config')
        .select('phone_number_id, is_active, display_name, created_at')
        .eq('user_id', userId)
        .maybeSingle()
      checks.whatsapp = waConfig
        ? { status: waConfig.is_active ? 'active' : 'inactive', phone_number_id: waConfig.phone_number_id, display_name: waConfig.display_name }
        : { status: 'not_configured' }
    } catch (e) {
      checks.whatsapp = { status: 'error', error: e instanceof Error ? e.message : 'unknown' }
    }

    // 3. Queue stats
    try {
      const { count: pending } = await admin.from('integration_webhook_logs')
        .select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'received')
      const { count: failed } = await admin.from('integration_webhook_logs')
        .select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'failed')
      const { count: delivered } = await admin.from('integration_webhook_logs')
        .select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'delivered')
      checks.queue = { pending: pending ?? 0, failed: failed ?? 0, delivered: delivered ?? 0 }
    } catch (e) {
      checks.queue = { status: 'error' }
    }

    // 4. Automation stats
    try {
      const { count: autoCount } = await admin.from('automations')
        .select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('is_active', true)
      checks.automations = { active: autoCount ?? 0 }
    } catch { checks.automations = { active: 0 } }

    // 5. Recent failures (last 5, no secrets)
    try {
      const { data: failures } = await admin.from('integration_webhook_logs')
        .select('event_type, status, created_at, response_body')
        .eq('user_id', userId).eq('status', 'failed')
        .order('created_at', { ascending: false }).limit(5)
      checks.recent_failures = failures ?? []
    } catch { checks.recent_failures = [] }

    // 6. Security events (last 10)
    try {
      const { data: secEvents } = await admin.from('security_events')
        .select('event_type, severity, created_at, route')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(10)
      checks.security_events = secEvents ?? []
    } catch { checks.security_events = [] }

    // 7. Heartbeat status
    try {
      const { data: lastBeat } = await admin.from('heartbeat_logs')
        .select('status, latency_ms, render_online, db_online, wa_online, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      checks.heartbeat = lastBeat ?? { status: 'no_data' }
    } catch { checks.heartbeat = { status: 'unknown' } }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      api_key_prefix: keyRecord.api_key.substring(0, 12) + '...',
      user_id_prefix: userId.substring(0, 8) + '...',
      render_online: true,
      render_environment: process.env.RENDER ? 'render' : 'local',
      checks,
    })

  } catch (err) {
    console.error('[integration/debug]', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
