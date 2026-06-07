/**
 * GET /api/security/ip-blacklist - Get IP blacklist
 * POST /api/security/ip-blacklist - Add IP to blacklist
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { writeAudit } from '@/lib/integrations/audit'

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

// GET - Get IP blacklist
export async function GET(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const activeOnly = searchParams.get('active_only') === 'true'
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')

  const admin = adminClient()
  let query = admin
    .from('ip_blacklist')
    .select('id, ip_address, ip_range, country_code, reason, threat_type, source, added_by, added_at, expires_at, notes, active, violation_count, last_violation_at', { count: 'exact' })
    .order('added_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (activeOnly) query = query.eq('active', true)

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ips: data || [],
    total: count || 0,
    limit,
    offset,
  })
}

// POST - Add IP to blacklist
export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { ip_address, ip_range, reason, threat_type, source = 'manual', expires_at, notes } = body

  if (!ip_address && !ip_range) {
    return NextResponse.json({ error: 'ip_address or ip_range is required' }, { status: 400 })
  }
  if (!reason) {
    return NextResponse.json({ error: 'reason is required' }, { status: 400 })
  }

  const admin = adminClient()
  const { data, error } = await admin
    .from('ip_blacklist')
    .insert({
      ip_address,
      ip_range,
      reason,
      threat_type,
      source,
      added_by: user.email || 'system',
      expires_at: expires_at || null,
      notes,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Audit log
  await writeAudit(admin, {
    userId:         user.id,
    actionType:     'ip_blacklisted',
    actionCategory: 'security',
    targetType:     'ip_address',
    targetId:       data.id,
    targetName:     ip_address || ip_range,
    description:    `IP ${ip_address || ip_range} added to blacklist. Reason: ${reason}`,
    endpoint:       '/api/security/ip-blacklist',
    method:         'POST',
  })

  return NextResponse.json({
    success: true,
    message: 'IP added to blacklist',
    ip: data,
  })
}
