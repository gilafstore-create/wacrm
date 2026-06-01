/**
 * API Key Individual Operations
 * 
 * GET    /api/api-keys/:id          - Get single API key
 * PUT    /api/api-keys/:id          - Update API key
 * DELETE /api/api-keys/:id          - Revoke API key
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

// GET /api/api-keys/:id - Get single API key
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = adminClient()
  const { data, error } = await admin
    .from('api_keys')
    .select('id, key_name, key_prefix, key_type, expires_at, status, created_at, last_used_at, last_used_ip, last_used_user_agent, usage_count, ip_whitelist, ip_blacklist, domain_whitelist, rate_limit_per_minute, rate_limit_per_hour, scope, description, tags, last_rotated_at, rotation_count, updated_at')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

// PUT /api/api-keys/:id - Update API key
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const allowedFields = [
    'key_name',
    'description',
    'tags',
    'ip_whitelist',
    'ip_blacklist',
    'domain_whitelist',
    'rate_limit_per_minute',
    'rate_limit_per_hour',
    'scope',
  ]

  const updateData: Record<string, unknown> = {}
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updateData[field] = body[field]
    }
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const admin = adminClient()
  const { data, error } = await admin
    .from('api_keys')
    .update({ ...updateData, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

// DELETE /api/api-keys/:id - Revoke API key
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const reason = body.reason || 'User requested revocation'

  const admin = adminClient()
  const { data, error } = await admin
    .from('api_keys')
    .update({
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      revoked_by: user.email || 'system',
      revoked_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    message: 'API key revoked successfully',
    key: data,
  })
}
