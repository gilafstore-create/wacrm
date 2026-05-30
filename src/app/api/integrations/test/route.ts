/**
 * POST /api/integrations/test
 * Test connection to a website + auto-discover capabilities
 * Body: { id?: string, website_url: string, website_api_key?: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

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

// Probe a URL with a timeout — never throws
async function probe(url: string, options: RequestInit = {}, timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = Date.now()
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    clearTimeout(timer)
    const latency = Date.now() - start
    let body: unknown = null
    try { body = await res.json() } catch { /* non-JSON is fine */ }
    return { ok: res.ok, status: res.status, body, latency, error: null }
  } catch (err: unknown) {
    clearTimeout(timer)
    const latency = Date.now() - start
    const isTimeout = (err as Error).name === 'AbortError'
    return {
      ok: false, status: 0, body: null, latency,
      error: isTimeout ? `Timeout after ${timeoutMs}ms` : (err as Error).message,
    }
  }
}

export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { id, website_url: rawUrl, website_api_key } = body

  if (!rawUrl) return NextResponse.json({ error: 'website_url required' }, { status: 400 })

  const base = rawUrl.replace(/\/$/, '')
  const checks: Record<string, unknown> = {}
  const endpoints: string[] = []
  let siteReachable  = false   // base URL responds at all
  let healthEndpoint = false   // dedicated /health route found
  let webhookFound   = false   // webhook endpoint found (any 2xx-4xx)
  let healthScore    = 0

  // ── 1. Check base URL reachable ──────────────────────────────────────────────
  const baseCheck = await probe(base, {}, 8000)
  if (baseCheck.status > 0 || baseCheck.ok) {
    siteReachable = true
    healthScore += 20
    checks.site = { reachable: true, status: baseCheck.status, latency_ms: baseCheck.latency }
  } else {
    checks.site = { reachable: false, error: baseCheck.error }
  }

  // ── 2. GilafStore-specific health endpoints ───────────────────────────────────
  const gilafHealthCandidates = [
    `${base}/admin/crm_heartbeat.php`,       // our new heartbeat cron endpoint
    `${base}/api/integration/health`,        // GilafStore WACRM proxy route
    `${base}/api/health`,
    `${base}/api/v1/status`,
    `${base}/api/v1/health`,
    `${base}/health`,
  ]
  for (const url of gilafHealthCandidates) {
    const headers: HeadersInit = { 'Accept': 'application/json' }
    if (website_api_key) headers['X-GilafStore-Key'] = website_api_key
    const r = await probe(url, { headers }, 6000)
    // A 200 OR 401/403 means the endpoint EXISTS (401/403 = auth required = alive)
    if (r.status >= 200 && r.status < 500) {
      checks.health = { url, status: r.status, latency_ms: r.latency }
      endpoints.push(url)
      if (r.ok) {
        healthEndpoint = true
        healthScore += 30  // full health endpoint responding
      } else {
        healthScore += 15  // endpoint exists but requires auth — that's fine
      }
      break
    }
  }

  // ── 3. Webhook endpoint probe ─────────────────────────────────────────────────
  const webhookCandidates = [
    `${base}/api/integration/webhook`,
    `${base}/api/wacrm-webhook`,
    `${base}/api/webhook`,
    `${base}/wc-api/wacrm_webhook`,
    `${base}/wp-json/wacrm/v1/webhook`,
  ]
  for (const url of webhookCandidates) {
    const r = await probe(url, {
      method: 'POST',
      body: '{"event":"test"}',
      headers: { 'Content-Type': 'application/json' },
    }, 5000)
    // Any response 200-499 means the URL exists (even 401/405 = endpoint is live)
    if (r.status >= 200 && r.status < 500) {
      checks.webhook = { url, status: r.status, supported: true }
      endpoints.push(url)
      webhookFound = true
      healthScore += 30
      break
    }
  }

  // ── 4. Platform detection ─────────────────────────────────────────────────────
  let platform = 'custom'
  let detectedVersion: string | null = null

  const wpCheck = await probe(`${base}/wp-json/wc/v3/system_status`, {}, 5000)
  if (wpCheck.ok) {
    platform = 'woocommerce'
    detectedVersion = (wpCheck.body as Record<string, unknown>)?.['woocommerce_version'] as string ?? null
    healthScore += 20
    endpoints.push(`${base}/wp-json/wc/v3`)
    checks.platform = { detected: 'WooCommerce', version: detectedVersion }
  } else {
    // WordPress without WooCommerce credentials — check WP REST API
    const wpBasicCheck = await probe(`${base}/wp-json`, {}, 4000)
    if (wpBasicCheck.ok) {
      platform = 'wordpress'
      healthScore += 10
      checks.platform = { detected: 'WordPress' }
    }
  }

  const shopifyCheck = await probe(`${base}/admin/api/2024-01/shop.json`, {}, 4000)
  if (shopifyCheck.status === 401) {
    platform = 'shopify'
    healthScore += 15
    checks.platform = { detected: 'Shopify' }
  }

  // ── 5. Calculate final status ─────────────────────────────────────────────────
  healthScore = Math.min(healthScore, 100)

  // "Connected" = site is reachable AND at least one endpoint found
  // For custom PHP sites, finding the webhook endpoint is enough to confirm integration is live
  const connected = siteReachable && (healthEndpoint || webhookFound || endpoints.length > 0)

  let overallStatus: 'active' | 'warning' | 'error' = 'error'
  if (healthScore >= 60) overallStatus = 'active'
  else if (healthScore >= 20 && siteReachable) overallStatus = 'warning'

  // ── 6. Generate human-readable recommendation ─────────────────────────────────
  let recommendation: string
  if (!siteReachable) {
    recommendation = 'Website is unreachable. Check the URL is correct and the site is live.'
  } else if (connected && healthEndpoint) {
    recommendation = 'All systems detected successfully. Ready to connect!'
  } else if (connected && webhookFound) {
    recommendation = 'Website detected ✓ Webhook endpoint found. You can proceed — upload the PHP files via FileZilla if not done yet.'
  } else if (siteReachable && endpoints.length > 0) {
    recommendation = 'Website is reachable ✓ Upload the 4 PHP files via FileZilla, then run crm_migration.php to complete setup.'
  } else if (siteReachable) {
    recommendation = 'Website is reachable ✓ No integration endpoints detected yet. Upload the PHP files via FileZilla to complete setup.'
  } else {
    recommendation = 'Could not connect. Verify the URL and ensure the site is publicly accessible.'
  }

  // ── 7. Persist to DB if integration ID provided ───────────────────────────────
  if (id) {
    const admin = adminClient()
    await admin.from('website_integrations').update({
      status:               overallStatus,
      health_score:         healthScore,
      discovered_version:   detectedVersion,
      discovered_endpoints: endpoints,
      last_discovery_at:    new Date().toISOString(),
      platform,
      ...(siteReachable ? { last_heartbeat_at: new Date().toISOString() } : {}),
    }).eq('id', id).eq('user_id', user.id)
  }

  return NextResponse.json({
    success: true,
    connected,
    site_reachable: siteReachable,
    health_endpoint: healthEndpoint,
    webhook_found: webhookFound,
    status: overallStatus,
    health_score: healthScore,
    platform,
    detected_version: detectedVersion,
    endpoints_found: endpoints,
    checks,
    recommendation,
  })
}
