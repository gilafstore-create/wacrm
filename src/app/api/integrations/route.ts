/**
 * GET  /api/integrations          — list all website integrations for current user
 * POST /api/integrations          — create / save a new integration
 * PUT  /api/integrations          — update an existing integration
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
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

// ── Mask sensitive values for UI display ──────────────────────────────────────
function maskKey(key: string): string {
  if (!key || key.length < 8) return '••••••••'
  return key.substring(0, 8) + '••••••••' + key.slice(-4)
}

function sanitizeIntegration(row: Record<string, unknown>) {
  return {
    ...row,
    website_api_key: maskKey(String(row.website_api_key ?? '')),
    website_secret:  maskKey(String(row.website_secret ?? '')),
    webhook_secret:  row.webhook_secret ? maskKey(String(row.webhook_secret ?? '')) : null,
    connection_token: row.connection_token
      ? (row.token_used_at ? '(used)' : maskKey(String(row.connection_token)))
      : null,
  }
}

// ── GET: list integrations ────────────────────────────────────────────────────
export async function GET() {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = adminClient()
  const { data, error } = await admin
    .from('website_integrations')
    .select(`
      id, website_name, website_url, platform, status, health_score,
      webhook_url, webhook_events, auto_sync_enabled, sync_interval_min,
      heartbeat_enabled, last_heartbeat_at, heartbeat_latency_ms,
      last_sync_at, last_error, total_webhooks_sent, total_webhooks_failed,
      total_synced_contacts, total_synced_orders, discovered_version,
      created_at, updated_at,
      website_api_key, website_secret, webhook_secret, connection_token, token_used_at,
      next_sync_at, last_sync_attempt_at, last_sync_status, last_sync_error,
      last_sync_duration_ms, consecutive_sync_failures
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    integrations: (data ?? []).map(sanitizeIntegration),
  })
}

// ── Helper: generate & hash API key (same format as api-keys route) ──────────
function generateMasterApiKey(): string {
  const prefix = 'gilaf_' + crypto.randomBytes(4).toString('hex').slice(0, 8)
  const secret = crypto.randomBytes(32).toString('base64').replace(/=+$/, '')
  return `${prefix}_${secret}`
}

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

// ── POST: create integration ──────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { website_name, website_url, website_api_key, webhook_url, platform } = body

  if (!website_name || !website_url) {
    return NextResponse.json({ error: 'website_name and website_url are required' }, { status: 400 })
  }

  // Guard: webhook_url is where WACRM DELIVERS events TO the store. It must never
  // be WACRM's own inbound endpoint, or outgoing webhooks 401 against ourselves.
  const cleanWebhookUrl =
    webhook_url && !String(webhook_url).includes('/api/integration/webhook')
      ? String(webhook_url).trim()
      : null

  // ── SINGLE MASTER API KEY ──────────────────────────────────────────────────
  // One key for the entire integration. Stored raw in website_integrations
  // (used by sync engine) AND hashed in api_keys (shown in API Key Management).
  const masterApiKey = website_api_key || generateMasterApiKey()
  const keyHash = hashApiKey(masterApiKey)
  const keyPrefix = masterApiKey.includes('_')
    ? masterApiKey.split('_')[0] + '_' + (masterApiKey.split('_')[1] ?? '').slice(0, 8)
    : masterApiKey.slice(0, 16)

  // Auto-generate secrets
  const websiteSecret  = 'whs_' + crypto.randomBytes(24).toString('hex')
  const webhookSecret  = 'wbk_' + crypto.randomBytes(24).toString('hex')
  const connectionToken = 'gs_connect_' + crypto.randomBytes(16).toString('hex')

  const admin = adminClient()

  // 1. Insert into website_integrations (RAW key — used by sync engine)
  const { data, error } = await admin.from('website_integrations').insert({
    user_id:          user.id,
    website_name:     website_name.trim(),
    website_url:      website_url.trim().replace(/\/$/, ''),
    platform:         platform ?? 'custom',
    website_api_key:  masterApiKey,
    website_secret:   websiteSecret,
    webhook_url:      cleanWebhookUrl,
    webhook_secret:   webhookSecret,
    connection_token: connectionToken,
    status:           'pending',
  }).select().maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 2. Insert into api_keys (HASHED key — shown in API Key Management tab)
  //    This ensures the same key appears in both places.
  await admin.from('api_keys').insert({
    key_name:             website_name.trim(),
    key_prefix:           keyPrefix,
    key_hash:             keyHash,
    key_fingerprint:      hashApiKey(masterApiKey + user.id + new Date().toISOString()),
    key_type:             'never_expire',
    user_id:              user.id,
    created_by:           user.email || 'system',
    scope:                ['read', 'write'],
    rate_limit_per_minute: 60,
    rate_limit_per_hour:   1000,
    description:          `Master key for ${website_name.trim()} integration`,
    tags:                 ['integration', 'master'],
    integration_id:       data.id,
  })

  await writeAudit(admin, {
    userId:         user.id,
    actionType:     'integration_created',
    actionCategory: 'integrations',
    targetType:     'integration',
    targetId:       data.id,
    targetName:     website_name.trim(),
    description:    `Integration created for ${website_url}`,
    endpoint:       '/api/integrations',
    method:         'POST',
  })

  // Return ALL credentials once — never shown again
  return NextResponse.json({
    success: true,
    id: data.id,
    connection_token: connectionToken,
    website_api_key:  masterApiKey,
    webhook_secret:   webhookSecret,
    website_secret:   websiteSecret,
    webhook_url:      cleanWebhookUrl,
    message: 'Integration created. Save your secrets — they will be masked after this response.',
  }, { status: 201 })
}

// ── PUT: update integration settings ─────────────────────────────────────────
export async function PUT(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { id, ...updates } = body

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Never allow overwriting secrets via this route
  const safe = { ...updates }
  delete safe.website_secret
  delete safe.webhook_secret
  delete safe.connection_token
  delete safe.user_id
  // Reject WACRM's own inbound endpoint as a delivery target (would 401 on itself)
  if (safe.webhook_url && String(safe.webhook_url).includes('/api/integration/webhook')) {
    delete safe.webhook_url
  }
  safe.updated_at = new Date().toISOString()

  const admin = adminClient()
  const { error } = await admin
    .from('website_integrations')
    .update(safe)
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // ── SYNC api_keys table when master API key changes ────────────────────────
  // This keeps both tables in perfect sync (single source of truth).
  if (safe.website_api_key) {
    const newKeyHash = hashApiKey(safe.website_api_key)
    const newPrefix = safe.website_api_key.includes('_')
      ? safe.website_api_key.split('_')[0] + '_' + (safe.website_api_key.split('_')[1] ?? '').slice(0, 8)
      : safe.website_api_key.slice(0, 16)

    // Try updating existing linked api_key first
    const { data: existing } = await admin
      .from('api_keys')
      .select('id')
      .eq('integration_id', id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (existing) {
      await admin.from('api_keys').update({
        key_hash: newKeyHash,
        key_prefix: newPrefix,
        key_fingerprint: hashApiKey(safe.website_api_key + user.id + new Date().toISOString()),
      }).eq('id', existing.id)
    } else {
      // No linked key exists — create one (handles legacy integrations)
      await admin.from('api_keys').insert({
        key_name:              'Integration Master Key',
        key_prefix:            newPrefix,
        key_hash:              newKeyHash,
        key_fingerprint:       hashApiKey(safe.website_api_key + user.id + new Date().toISOString()),
        key_type:              'never_expire',
        user_id:               user.id,
        created_by:            user.email || 'system',
        scope:                 ['read', 'write'],
        rate_limit_per_minute: 60,
        rate_limit_per_hour:   1000,
        description:           `Master key for integration`,
        tags:                  ['integration', 'master'],
        integration_id:        id,
      })
    }
  }

  await writeAudit(admin, {
    userId:         user.id,
    actionType:     'integration_updated',
    actionCategory: 'integrations',
    targetType:     'integration',
    targetId:       id,
    description:    `Integration settings updated: ${Object.keys(safe).filter(k => k !== 'updated_at').join(', ')}`,
    endpoint:       '/api/integrations',
    method:         'PUT',
  })

  return NextResponse.json({ success: true })
}

// ── DELETE: remove integration ────────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = adminClient()
  const { error } = await admin
    .from('website_integrations')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await writeAudit(admin, {
    userId:         user.id,
    actionType:     'integration_deleted',
    actionCategory: 'integrations',
    targetType:     'integration',
    targetId:       id,
    description:    'Integration removed',
    endpoint:       '/api/integrations',
    method:         'DELETE',
  })

  return NextResponse.json({ success: true })
}
