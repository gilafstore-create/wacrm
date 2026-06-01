/**
 * GET /api/audit/logs   - Retrieve audit logs with filtering
 * POST /api/audit/logs  - Write a manual audit log entry
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
  const actionCategory = searchParams.get('action_category')
  const actionType = searchParams.get('action_type')
  const targetType = searchParams.get('target_type')
  const success = searchParams.get('success')
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
  const offset = parseInt(searchParams.get('offset') || '0')

  const admin = adminClient()
  let query = admin
    .from('audit_logs')
    .select(
      'id, action_type, action_category, target_type, target_id, target_name, ' +
      'ip_address, user_agent, endpoint, method, description, reason, tags, ' +
      'success, error_message, created_at, user_id',
      { count: 'exact' }
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (actionCategory && actionCategory !== 'all') query = query.eq('action_category', actionCategory)
  if (actionType) query = query.eq('action_type', actionType)
  if (targetType) query = query.eq('target_type', targetType)
  if (success !== null && success !== '') query = query.eq('success', success === 'true')

  const { data, error, count } = await query

  if (error) {
    // Table may not exist yet (migration not run) — return empty gracefully
    if (error.code === '42P01') {
      return NextResponse.json({ logs: [], total: 0, limit, offset })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    logs: data || [],
    total: count || 0,
    limit,
    offset,
  })
}

export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const {
    action_type,
    action_category,
    target_type,
    target_id,
    target_name,
    description,
    reason,
    tags,
    success = true,
    error_message,
    ip_address,
    endpoint,
    method,
  } = body

  if (!action_type || !action_category) {
    return NextResponse.json({ error: 'action_type and action_category are required' }, { status: 400 })
  }

  const admin = adminClient()
  const { data, error } = await admin
    .from('audit_logs')
    .insert({
      user_id: user.id,
      action_type,
      action_category,
      target_type,
      target_id,
      target_name,
      description,
      reason,
      tags,
      success,
      error_message,
      ip_address,
      endpoint,
      method,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '42P01') {
      return NextResponse.json({ warning: 'audit_logs table not created yet — run migration 024', logged: false })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ logged: true, log: data })
}
