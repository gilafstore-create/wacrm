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

// Probe a URL with a timeout
async function probe(url: string, options: RequestInit = {}, timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = Date.now()
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    clearTimeout(timer)
    const latency = Date.now() - start
    let body: unknown = null
    try { body = await res.json() } catch { /* non-JSON */ }
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
  let healthOk = false
  let overallStatus: 'active' | 'warning' | 'error' = 'error'
  let healthScore = 0

  // ── Probe known endpoint patterns ────────────────────────────────────────────
  const candidateHealthUrls = [
    `${base}/api/integration/health`,  // GilafStore WACRM standard
    `${base}/api/health`,
    `${base}/wp-json/wc/v3/system_status`, // WooCommerce
    `${base}/api/v1/status`,
  ]

  for (const url of candidateHealthUrls) {
    const headers: HeadersInit = { 'Accept': 'application/json' }
    if (website_api_key) headers['X-GilafStore-Key'] = website_api_key
    const result = await probe(url, { headers })
    if (result.ok) {
      checks.health = { url, status: result.status, latency_ms: result.latency, body: result.body }
      endpoints.push(url)
      healthOk = true
      healthScore += 40
      break
    }
  }

  if (!healthOk) {
    // At minimum check base URL is reachable
    const baseCheck = await probe(base, {})
    checks.reachable = { ok: baseCheck.ok, status: baseCheck.status, latency_ms: baseCheck.latency }
    if (baseCheck.ok) healthScore += 10
  }

  // ── Probe webhook endpoint ────────────────────────────────────────────────────
  const webhookCandidates = [
    `${base}/api/integration/webhook`,
    `${base}/wc-api/wacrm_webhook`,
    `${base}/api/webhook`,
  ]
  for (const url of webhookCandidates) {
    const r = await probe(url, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }, 5000)
    // 401/403/405 all mean the URL exists but rejected our unauthenticated probe
    if (r.status >= 200 && r.status < 500) {
      checks.webhook = { url, status: r.status, supported: true }
      endpoints.push(url)
      healthScore += 30
      break
    }
  }

  // ── Detect platform ───────────────────────────────────────────────────────────
  let platform = 'custom'
  let detectedVersion: string | null = null

  const wpCheck = await probe(`${base}/wp-json/wc/v3/system_status`, {}, 5000)
  if (wpCheck.ok) {
    platform = 'woocommerce'
    detectedVersion = (wpCheck.body as Record<string, unknown>)?.['woocommerce_version'] as string ?? null
    healthScore += 20
    endpoints.push(`${base}/wp-json/wc/v3`)
    checks.platform = { detected: 'WooCommerce', version: detectedVersion }
  }

  const shopifyCheck = await probe(`${base}/admin/api/2024-01/shop.json`, {}, 5000)
  if (shopifyCheck.status === 401) {
    platform = 'shopify'
    healthScore += 15
    checks.platform = { detected: 'Shopify' }
  }

  if (healthScore >= 70) overallStatus = 'active'
  else if (healthScore >= 30) overallStatus = 'warning'

  // Cap score at 100
  healthScore = Math.min(healthScore, 100)

  // ── Persist discovery results if integration ID provided ──────────────────────
  if (id) {
    const admin = adminClient()
    await admin.from('website_integrations').update({
      status:                overallStatus,
      health_score:          healthScore,
      discovered_version:    detectedVersion,
      discovered_endpoints:  endpoints,
      last_discovery_at:     new Date().toISOString(),
      platform,
      last_heartbeat_at:     new Date().toISOString(),
    }).eq('id', id).eq('user_id', user.id)
  }

  return NextResponse.json({
    success: true,
    connected: healthOk,
    status: overallStatus,
    health_score: healthScore,
    platform,
    detected_version: detectedVersion,
    endpoints_found: endpoints,
    checks,
    recommendation: !healthOk
      ? 'Could not reach a health endpoint. Ensure the Website Integration plugin is installed and the URL is correct.'
      : overallStatus === 'warning'
      ? 'Partial connectivity. Webhook endpoint may not be configured.'
      : 'All systems connected successfully.',
  })
}
