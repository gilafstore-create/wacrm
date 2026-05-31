/**
 * POST /api/integrations/activate
 * ────────────────────────────────
 * Accepts a connection_token (gs_connect_xxx) from GilafStore.
 * Returns the full integration config so GilafStore can auto-configure itself.
 *
 * This is a PUBLIC endpoint — no auth required (the token IS the auth).
 * Rate-limited by IP to prevent brute-force.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { token, website_url } = body

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Connection token is required' }, { status: 400 })
    }

    if (!token.startsWith('gs_connect_')) {
      return NextResponse.json({ error: 'Invalid token format. Must start with gs_connect_' }, { status: 400 })
    }

    const admin = adminClient()

    // Look up the integration by connection_token
    const { data: integration, error } = await admin
      .from('website_integrations')
      .select('*')
      .eq('connection_token', token)
      .maybeSingle()

    if (error || !integration) {
      return NextResponse.json({
        error: 'Invalid or expired connection token. Please generate a new one from WACRM.',
      }, { status: 404 })
    }

    // Check if already activated — still return config (idempotent)
    const alreadyActivated = !!integration.token_used_at

    // Mark token as used (if first time)
    if (!alreadyActivated) {
      await admin
        .from('website_integrations')
        .update({
          token_used_at: new Date().toISOString(),
          status: 'active',
          updated_at: new Date().toISOString(),
          // Optionally store the website URL that activated it
          ...(website_url ? { website_url: website_url.replace(/\/$/, '') } : {}),
        })
        .eq('id', integration.id)
    }

    const wacrmBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://wacrm-wbjb.onrender.com'

    // Return everything GilafStore needs to auto-configure
    return NextResponse.json({
      success: true,
      already_activated: alreadyActivated,
      message: alreadyActivated
        ? 'Token was already activated. Returning existing configuration.'
        : 'Connection activated successfully! GilafStore is now linked to WACRM.',

      // Config for GilafStore to save
      config: {
        wacrm_api_url:    wacrmBaseUrl,
        webhook_url:      `${wacrmBaseUrl}/api/integration/webhook`,
        website_api_key:  integration.website_api_key,
        website_secret:   integration.website_secret,
        webhook_secret:   integration.webhook_secret,
        website_name:     integration.website_name,
        integration_id:   integration.id,
      },
    })

  } catch (err) {
    console.error('[integrations/activate]', err)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
