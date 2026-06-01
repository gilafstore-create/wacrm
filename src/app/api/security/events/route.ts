/**
 * GET /api/security/events - Get security events
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

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
  const severity = searchParams.get('severity')
  const eventType = searchParams.get('event_type')
  const resolved = searchParams.get('resolved')
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')

  const admin = adminClient()
  let query = admin
    .from('security_events')
    .select('id, event_type, severity, user_id, api_key_id, integration_id, ip_address, endpoint, method, event_data, description, resolved, resolved_at, resolved_by, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (severity) query = query.eq('severity', severity)
  if (eventType) query = query.eq('event_type', eventType)
  if (resolved !== null) query = query.eq('resolved', resolved === 'true')

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    events: data || [],
    total: count || 0,
    limit,
    offset,
  })
}
