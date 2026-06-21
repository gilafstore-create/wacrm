/**
 * API Key Management Endpoints
 * 
 * GET    /api/api-keys              - List all API keys
 * POST   /api/api-keys              - Create new API key
 * GET    /api/api-keys/:id          - Get single API key
 * PUT    /api/api-keys/:id          - Update API key
 * DELETE /api/api-keys/:id          - Revoke API key
 * POST   /api/api-keys/:id/rotate   - Rotate API key
 * POST   /api/api-keys/:id/disable  - Disable API key
 * POST   /api/api-keys/:id/enable   - Enable API key
 * GET    /api/api-keys/:id/usage    - Get usage statistics
 * GET    /api/api-keys/:id/audit    - Get audit log
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

// Helper: Generate API key
function generateApiKey(): string {
  const prefix = 'gilaf_' + crypto.randomBytes(4).toString('hex').slice(0, 8)
  const secret = crypto.randomBytes(32).toString('base64').replace(/=+$/, '')
  return `${prefix}_${secret}`
}

// Helper: Hash API key
function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

// Helper: Calculate expiry — always returns ISO string or null
function calculateExpiry(keyType: string, customDays?: number): string | null {
  const now = new Date()
  switch (keyType) {
    case '24h':
      return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
    case '7d':
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
    case '30d':
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
    case '90d':
      return new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString()
    case '1y':
      return new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString()
    case 'custom':
      if (customDays) {
        return new Date(now.getTime() + customDays * 24 * 60 * 60 * 1000).toISOString()
      }
      return null
    case 'never_expire':
    default:
      return null
  }
}

// GET /api/api-keys - List all API keys
export async function GET(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const keyType = searchParams.get('key_type')
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')

  const admin = adminClient()
  let query = admin
    .from('api_keys')
    .select('id, key_name, key_prefix, key_type, expires_at, status, created_at, last_used_at, usage_count, description, tags, updated_at', { count: 'exact' })
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)
  if (keyType) query = query.eq('key_type', keyType)

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    keys: data || [],
    total: count || 0,
    limit,
    offset,
  })
}

// POST /api/api-keys - Create new API key
export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const {
    key_name,
    key_type = 'never_expire',
    custom_expiry_days,
    scope = ['read', 'write'],
    ip_whitelist,
    ip_blacklist,
    domain_whitelist,
    rate_limit_per_minute = 60,
    rate_limit_per_hour = 1000,
    description,
    tags,
  } = body

  if (!key_name) {
    return NextResponse.json({ error: 'key_name is required' }, { status: 400 })
  }

  const fullKey = generateApiKey()
  const keyHash = hashApiKey(fullKey)
  const keyPrefix = fullKey.split('_')[0] + '_' + fullKey.split('_')[1]?.slice(0, 8)
  const expiresAt = calculateExpiry(key_type, custom_expiry_days)

  const admin = adminClient()
  const { data, error } = await admin
    .from('api_keys')
    .insert({
      key_name,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      key_fingerprint: hashApiKey(fullKey + user.id),
      key_type,
      expires_at: expiresAt,
      custom_expiry_days: key_type === 'custom' ? custom_expiry_days : null,
      user_id: user.id,
      created_by: user.email || 'system',
      scope,
      ip_whitelist,
      ip_blacklist,
      domain_whitelist,
      rate_limit_per_minute,
      rate_limit_per_hour,
      description,
      tags,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Only return full key on creation
  return NextResponse.json({
    ...data,
    full_key: fullKey, // Only time full key is returned
  })
}
