/**
 * POST /api/api-keys/:id/rotate - Rotate API key
 * Generates a new key while keeping the same ID
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
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

function generateApiKey(): string {
  const prefix = 'gilaf_' + crypto.randomBytes(4).toString('hex').slice(0, 8)
  const secret = crypto.randomBytes(32).toString('base64').replace(/=+$/, '')
  return `${prefix}_${secret}`
}

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const reason = body.reason || 'Key rotation requested'

  const admin = adminClient()

  // Get current key to preserve settings
  const { data: currentKey, error: fetchError } = await admin
    .from('api_keys')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (fetchError) {
    if (fetchError.code === 'PGRST116') {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    }
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  // Generate new key
  const fullKey = generateApiKey()
  const keyHash = hashApiKey(fullKey)
  const keyPrefix = fullKey.split('_')[0] + '_' + fullKey.split('_')[1]?.slice(0, 8)

  // Calculate new expiry if key has expiry
  let expiresAt = currentKey.expires_at
  if (currentKey.key_type !== 'never_expire' && currentKey.expires_at) {
    const now = new Date()
    const originalExpiry = new Date(currentKey.expires_at)
    const originalCreated = new Date(currentKey.created_at)
    const daysRemaining = Math.floor((originalExpiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    
    if (daysRemaining > 0) {
      expiresAt = new Date(now.getTime() + daysRemaining * 24 * 60 * 60 * 1000)
    }
  }

  // Update key with new hash
  const { data, error } = await admin
    .from('api_keys')
    .update({
      key_hash: keyHash,
      key_prefix: keyPrefix,
      key_fingerprint: hashApiKey(fullKey + user.id + new Date().toISOString()),
      expires_at: expiresAt,
      last_rotated_at: new Date().toISOString(),
      rotation_count: (currentKey.rotation_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ...data,
    full_key: fullKey, // Only return full key on rotation
    message: 'API key rotated successfully',
  })
}
