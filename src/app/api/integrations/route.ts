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
    website_secret:  '••••••••••••••••',  // never expose
    webhook_secret:  row.webhook_secret ? '••••••••••••••••' : null,
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
      website_api_key, website_secret, webhook_secret, connection_token, token_used_at
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    integrations: (data ?? []).map(sanitizeIntegration),
  })
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

  // Auto-generate secrets
  const websiteSecret  = 'whs_' + crypto.randomBytes(24).toString('hex')
  const webhookSecret  = 'wbk_' + crypto.randomBytes(24).toString('hex')
  const connectionToken = 'gs_connect_' + crypto.randomBytes(16).toString('hex')

  const admin = adminClient()
  const { data, error } = await admin.from('website_integrations').insert({
    user_id:          user.id,
    website_name:     website_name.trim(),
    website_url:      website_url.trim().replace(/\/$/, ''),
    platform:         platform ?? 'custom',
    website_api_key:  website_api_key ?? ('gsk_' + crypto.randomBytes(20).toString('hex')),
    website_secret:   websiteSecret,
    webhook_url:      webhook_url ?? null,
    webhook_secret:   webhookSecret,
    connection_token: connectionToken,
    status:           'pending',
  }).select().maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Return raw token once — never again
  return NextResponse.json({
    success: true,
    id: data.id,
    connection_token: connectionToken,
    webhook_secret:   webhookSecret,
    website_secret:   websiteSecret,
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
  safe.updated_at = new Date().toISOString()

  const admin = adminClient()
  const { error } = await admin
    .from('website_integrations')
    .update(safe)
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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
  return NextResponse.json({ success: true })
}
