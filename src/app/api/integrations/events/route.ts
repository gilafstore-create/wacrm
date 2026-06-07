/**
 * GET /api/integrations/events
 * Returns incoming_events for the authenticated user's integrations.
 *
 * Query params:
 *   integration_id  – filter by integration (required)
 *   limit           – default 50, max 200
 *   offset          – pagination offset (default 0)
 *   status          – processed | ignored | partial | failed
 *   event_name      – filter by event type
 *   q               – full-text search (event_name, payload, source_ip)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

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

export async function GET(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const integrationId = searchParams.get('integration_id')
  const limit  = Math.min(parseInt(searchParams.get('limit')  || '50'), 200)
  const offset = parseInt(searchParams.get('offset') || '0')
  const status = searchParams.get('status')
  const eventName = searchParams.get('event_name')
  const q = searchParams.get('q')?.trim()

  if (!integrationId) {
    return NextResponse.json({ error: 'integration_id is required' }, { status: 400 })
  }

  const admin = adminClient()

  // Verify the integration belongs to this user
  const { data: intg } = await admin
    .from('website_integrations')
    .select('id')
    .eq('id', integrationId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!intg) {
    return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
  }

  // Build query
  let query = admin
    .from('incoming_events')
    .select('*', { count: 'exact' })
    .eq('user_id', user.id)
    .eq('integration_id', integrationId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)
  if (eventName) query = query.eq('event_name', eventName)

  // Full-text search: search event_name, source_ip, error_message
  if (q) {
    query = query.or(
      `event_name.ilike.%${q}%,source_ip.ilike.%${q}%,error_message.ilike.%${q}%,event_id.ilike.%${q}%`
    )
  }

  const { data: events, count, error } = await query

  if (error) {
    console.error('[events/route] Query error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Aggregate stats for this integration
  const { data: stats } = await admin
    .from('incoming_events')
    .select('status')
    .eq('user_id', user.id)
    .eq('integration_id', integrationId)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

  const statCounts = (stats || []).reduce(
    (acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc },
    {} as Record<string, number>
  )

  return NextResponse.json({
    events: events || [],
    total: count ?? 0,
    stats: statCounts,
    limit,
    offset,
  })
}
