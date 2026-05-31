/**
 * POST /api/integration/connect-token
 * One-Token Setup System
 * ─────────────────────
 * POST body: { token: "gs_connect_xxxx" }
 * Returns: { api_key, api_secret, webhook_url } — one time only
 *
 * The token is issued by the WACRM user via the Integration Wizard.
 * GilafStore pastes it once — the system generates all keys automatically.
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { applyRateLimit, getClientIP, logSecurityEvent } from '@/lib/integration/middleware'
import crypto from 'crypto'

export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  try {
    // Rate limit by IP — no API key yet
    const fakeKey = `ip:${ip}`
    const limited = await applyRateLimit(request, fakeKey, 'connect-token')
    if (limited) return limited

    const body = await request.json()
    const { token } = body

    if (!token || !String(token).startsWith('gs_connect_')) {
      return NextResponse.json({ error: 'Invalid connection token format' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin: any = supabaseAdmin()

    // Look up token
    const { data: tokenRecord, error: tokenErr } = await admin
      .from('connection_tokens')
      .select('id, user_id, is_used, used_at, expires_at, revoked_at, integration_key_id')
      .eq('token', token)
      .maybeSingle()

    if (tokenErr || !tokenRecord) {
      await logSecurityEvent('invalid_connection_token', 'high', {
        ip, details: { token: token.substring(0, 20) + '...' },
      })
      return NextResponse.json({ error: 'Invalid or expired connection token' }, { status: 401 })
    }

    if (tokenRecord.revoked_at) {
      return NextResponse.json({ error: 'Connection token has been revoked' }, { status: 401 })
    }

    if (new Date(tokenRecord.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Connection token has expired' }, { status: 401 })
    }

    // If already used — return existing key info (idempotent for same consumer)
    if (tokenRecord.is_used && tokenRecord.integration_key_id) {
      const { data: existingKey } = await admin
        .from('integration_keys')
        .select('api_key, key_prefix, created_at')
        .eq('id', tokenRecord.integration_key_id)
        .maybeSingle()

      return NextResponse.json({
        success: true,
        message: 'Token already activated',
        api_key: existingKey?.api_key,
        webhook_url: `${process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? ''}/api/integration/webhook`,
        already_activated: true,
      })
    }

    // Generate new API key pair (gs_live_ prefix)
    const rawKey    = `gs_live_${crypto.randomBytes(24).toString('hex')}`
    const rawSecret = crypto.randomBytes(32).toString('hex')
    const keyPrefix = rawKey.substring(0, 15)

    // Create integration key
    const { data: newKey, error: keyErr } = await admin
      .from('integration_keys')
      .insert({
        user_id:    tokenRecord.user_id,
        key_name:   `GilafStore Connection (${new Date().toLocaleDateString('en-IN')})`,
        api_key:    rawKey,
        api_secret: rawSecret,  // store raw — is_bcrypt = false for now (future migration)
        is_active:  true,
        is_bcrypt:  false,
        key_prefix: keyPrefix,
        permissions: ['*'],
      })
      .select('id')
      .maybeSingle()

    if (keyErr || !newKey) {
      return NextResponse.json({ error: 'Failed to create integration key' }, { status: 500 })
    }

    // Mark token as used
    await admin.from('connection_tokens').update({
      is_used:           true,
      used_at:           new Date().toISOString(),
      integration_key_id: newKey.id,
    }).eq('id', tokenRecord.id)

    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? ''}/api/integration/webhook`

    return NextResponse.json({
      success: true,
      message: 'Connection established successfully',
      api_key:     rawKey,    // shown once
      api_secret:  rawSecret, // shown once — never returned again
      webhook_url: webhookUrl,
      user_id_prefix: tokenRecord.user_id.substring(0, 8) + '...',
    })

  } catch (err) {
    console.error('[integration/connect-token]', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}

/**
 * POST /api/integration/generate-token
 * Called by the WACRM dashboard to issue a new one-time connection token
 * Requires Supabase session auth
 */
export async function PUT(request: NextRequest) {
  try {
    const { createServerClient } = await import('@supabase/ssr')
    const { cookies } = await import('next/headers')
    const cookieStore = await cookies()

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const label = body.label ?? 'Integration Token'

    const token = `gs_connect_${crypto.randomBytes(16).toString('hex')}`

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin: any = supabaseAdmin()
    const { data, error } = await admin.from('connection_tokens').insert({
      user_id:   user.id,
      token,
      label,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
    }).select('id, token, label, expires_at, created_at').maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({
      success: true,
      token: data.token,
      label: data.label,
      expires_at: data.expires_at,
      webhook_url: `${process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? ''}/api/integration/webhook`,
    })

  } catch (err) {
    console.error('[integration/connect-token PUT]', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
