/**
 * GET /api/integration/analytics
 * Returns CRM analytics: revenue, message stats, campaign performance, webhook stats
 * Query params: ?type=overview|campaign|webhook&period=7d|30d|90d
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { validateApiKey, applyRateLimit } from '@/lib/integration/middleware'

export async function GET(request: NextRequest) {
  try {
    const apiKey = request.headers.get('X-GilafStore-Key') ?? ''
    if (!apiKey) return NextResponse.json({ error: 'Missing API key' }, { status: 401 })

    const limited = await applyRateLimit(request, apiKey, 'analytics')
    if (limited) return limited

    const { record: keyRecord, error: keyError } = await validateApiKey(apiKey)
    if (keyError || !keyRecord) {
      return NextResponse.json({ error: keyError ?? 'Invalid key' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const type   = searchParams.get('type') ?? 'overview'
    const period = searchParams.get('period') ?? '30d'

    const periodDays = period === '7d' ? 7 : period === '90d' ? 90 : 30
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin: any = supabaseAdmin()
    const userId = keyRecord.user_id

    if (type === 'overview') {
      const [msgs, revenue, webhooks, contacts, secEvents] = await Promise.allSettled([
        // Messages
        admin.from('integration_message_logs')
          .select('status', { count: 'exact' })
          .eq('user_id', userId)
          .gte('created_at', since),
        // Revenue
        admin.from('integration_revenue_events')
          .select('revenue, attributed_to, created_at')
          .eq('user_id', userId)
          .gte('created_at', since),
        // Webhooks
        admin.from('integration_webhook_logs')
          .select('status, event_type, duration_ms, created_at')
          .eq('user_id', userId)
          .gte('created_at', since),
        // New contacts
        admin.from('contacts')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .gte('created_at', since),
        // Security events
        admin.from('security_events')
          .select('event_type, severity, created_at')
          .eq('user_id', userId)
          .gte('created_at', since),
      ])

      type MsgRow = { status: string }
      type RevRow = { revenue: string | number | null; attributed_to: string | null; created_at: string }
      type WhRow  = { status: string; event_type: string; duration_ms: number | null; created_at: string }

      const msgData = msgs.status === 'fulfilled' ? (msgs.value.data ?? []) as MsgRow[] : [] as MsgRow[]
      const revData = revenue.status === 'fulfilled' ? (revenue.value.data ?? []) as RevRow[] : [] as RevRow[]
      const whData  = webhooks.status === 'fulfilled' ? (webhooks.value.data ?? []) as WhRow[] : [] as WhRow[]

      const totalRevenue = revData.reduce((s: number, r: RevRow) => s + parseFloat(String(r.revenue ?? 0)), 0)
      const msgSent      = msgData.length
      const msgFailed    = msgData.filter((m: MsgRow) => m.status === 'failed').length
      const deliveryRate = msgSent > 0 ? Math.round(((msgSent - msgFailed) / msgSent) * 100) : 0

      const whSuccess     = whData.filter((w: WhRow) => w.status === 'delivered').length
      const whFailed      = whData.filter((w: WhRow) => w.status === 'failed').length
      const whSuccessRate = whData.length > 0 ? Math.round((whSuccess / whData.length) * 100) : 0
      const avgLatency    = whData.length > 0
        ? Math.round(whData.reduce((s: number, w: WhRow) => s + (w.duration_ms ?? 0), 0) / whData.length)
        : 0

      return NextResponse.json({
        success: true,
        period,
        overview: {
          messages_sent:          msgSent,
          messages_failed:        msgFailed,
          delivery_rate:          deliveryRate,
          total_revenue:          totalRevenue,
          new_contacts:           contacts.status === 'fulfilled' ? contacts.value.count ?? 0 : 0,
          webhooks_received:      whData.length,
          webhooks_failed:        whFailed,
          webhook_success_rate:   whSuccessRate,
          avg_webhook_latency_ms: avgLatency,
          security_events:        secEvents.status === 'fulfilled' ? secEvents.value.data?.length ?? 0 : 0,
        },
        revenue_by_attribution: revData.reduce((acc: Record<string, number>, r: RevRow) => {
          const key = r.attributed_to ?? 'organic'
          acc[key] = (acc[key] ?? 0) + parseFloat(String(r.revenue ?? 0))
          return acc
        }, {}),
        webhook_by_event: whData.reduce((acc: Record<string, number>, w: WhRow) => {
          acc[w.event_type] = (acc[w.event_type] ?? 0) + 1
          return acc
        }, {}),
      })
    }

    return NextResponse.json({ success: true, type, message: 'Use type=overview' })

  } catch (err) {
    console.error('[integration/analytics]', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
