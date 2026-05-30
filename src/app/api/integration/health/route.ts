import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Lazy service-role client — mirrors the pattern in src/lib/flows/admin-client.ts
let _adminClient: ReturnType<typeof createClient> | null = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

/**
 * GET /api/integration/health
 *
 * Public health-check endpoint used by GilafStore's "Test Connection" button.
 * Returns HTTP 200 with a JSON body so PHP's simpleHealthCheck() succeeds.
 *
 * Also accepts POST (for authenticated health checks from apiRequest()).
 */
export async function GET() {
  return buildHealthResponse()
}

export async function POST(request: Request) {
  // Authenticated health check — validates the API key if supplied,
  // returns additional diagnostic fields.
  const apiKey = request.headers.get('X-GilafStore-Key')

  if (!apiKey) {
    // No key → basic health only (same as GET)
    return buildHealthResponse()
  }

  const admin = supabaseAdmin()
  let dbStatus = 'unknown'
  let apiKeyValid = false
  let userId: string | null = null

  try {
    const { data: keyRecord, error: keyError } = await admin
      .from('integration_keys')
      .select('id, user_id, is_active')
      .eq('api_key', apiKey)
      .eq('is_active', true)
      .maybeSingle()

    dbStatus = keyError ? `error: ${keyError.message}` : 'connected'
    apiKeyValid = !!keyRecord
    userId = keyRecord?.user_id ?? null
  } catch (err) {
    dbStatus = err instanceof Error ? `exception: ${err.message}` : 'exception'
  }

  return NextResponse.json(
    {
      success: true,
      service: 'WACRM',
      status: 'healthy',
      database: dbStatus,
      api_key_valid: apiKeyValid,
      user_id: userId,
      render: !!process.env.RENDER,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  )
}

function buildHealthResponse() {
  const supabaseConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY

  return NextResponse.json(
    {
      success: true,
      service: 'WACRM',
      status: 'healthy',
      version: process.env.npm_package_version ?? 'unknown',
      database: supabaseConfigured ? 'configured' : 'not_configured',
      render: !!process.env.RENDER,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  )
}
