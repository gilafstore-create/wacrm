/**
 * Integration Security Middleware
 * ================================
 * Shared utilities for all /api/integration/* routes:
 *   - API key validation with bcrypt support (new keys) + plain-text (legacy)
 *   - Rate limiting per API key + per IP
 *   - Security event logging
 *   - Webhook replay protection (nonce + timestamp)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { checkRateLimit, rateLimitResponse, type RateLimitOptions } from '@/lib/rate-limit'

// ── Supabase admin client (service role) ──────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null
export function supabaseAdmin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

// ── In-process auth metrics (for Render log monitoring) ───────────────────────
let _authRequestCount = 0
let _authRateLimitCount = 0

export function getAuthMetrics() {
  return { auth_request_count: _authRequestCount, auth_rate_limit_count: _authRateLimitCount }
}

// ── In-process API key cache (30s TTL) ───────────────────────────────────────
// Caches successful API key validations to avoid repeated DB hits on every
// scheduler tick (5000ms) or webhook burst. The service-role Supabase client
// does NOT count against Auth rate limits, but DB query volume still matters.
const _keyCache = new Map<string, { record: ApiKeyRecord; expiresAt: number }>()
const KEY_CACHE_TTL_MS = 30_000  // 30 seconds

function getCachedKey(apiKey: string): ApiKeyRecord | null {
  const entry = _keyCache.get(apiKey)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    _keyCache.delete(apiKey)
    return null
  }
  return entry.record
}

function setCachedKey(apiKey: string, record: ApiKeyRecord): void {
  _keyCache.set(apiKey, { record, expiresAt: Date.now() + KEY_CACHE_TTL_MS })
}

export function invalidateCachedKey(apiKey: string): void {
  _keyCache.delete(apiKey)
}

// ── Exponential backoff retry for Supabase 429 / transient errors ─────────────
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1_000,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err: unknown) {
      lastErr = err
      const is429 =
        (err as { status?: number })?.status === 429 ||
        (err as { code?: string })?.code === 'over_request_rate_limit'
      if (is429) {
        _authRateLimitCount++
        console.warn(
          `[auth-cache] Supabase rate limit hit (attempt ${attempt}/${maxAttempts}) — ` +
          `backing off ${baseDelayMs * attempt}ms | total_429s=${_authRateLimitCount}`
        )
      }
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, baseDelayMs * attempt))
      }
    }
  }
  throw lastErr
}

// ── Rate limit budgets for integration routes ─────────────────────────────────
export const INTEGRATION_RATE_LIMITS = {
  health:       { limit: 120, windowMs: 60_000 },  // 120/min
  webhook:      { limit: 200, windowMs: 60_000 },  // 200/min
  'send-message': { limit: 100, windowMs: 60_000 }, // 100/min
  'send-otp':   { limit: 10,  windowMs: 60_000 },  // 10/min (strict)
  'sync-customer': { limit: 60, windowMs: 60_000 },// 60/min
  conversations: { limit: 120, windowMs: 60_000 },
  messages:     { limit: 120, windowMs: 60_000 },
  debug:        { limit: 30,  windowMs: 60_000 },
  segments:     { limit: 60,  windowMs: 60_000 },
  'quick-replies': { limit: 60, windowMs: 60_000 },
  analytics:    { limit: 60,  windowMs: 60_000 },
  'connect-token': { limit: 10, windowMs: 60_000 },
} as const

// ── Extract client IP ─────────────────────────────────────────────────────────
export function getClientIP(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
}

// ── Validate API key and return the key record ────────────────────────────────
export interface ApiKeyRecord {
  id: string
  user_id: string
  api_key: string
  api_secret: string
  is_bcrypt: boolean
  is_active: boolean
  revoked_at: string | null
  expires_at: string | null
  permissions: string[]
}

export async function validateApiKey(
  apiKey: string,
): Promise<{ record: ApiKeyRecord | null; error: string | null; rejectionReason?: string }> {
  if (!apiKey) return { record: null, error: 'Missing API key', rejectionReason: 'missing' }

  // ── Check in-process cache first ────────────────────────────────────────────────────
  const cached = getCachedKey(apiKey)
  if (cached) {
    return { record: cached, error: null }
  }

  _authRequestCount++

  const admin = supabaseAdmin()

  // ── 1. Try integration_keys (gcrm_... prefix) ──────────────────────────────────
  const keyResult = await withRetry(() =>
    admin
      .from('integration_keys')
      .select('id, user_id, api_key, api_secret, is_bcrypt, is_active, revoked_at, expires_at, permissions')
      .eq('api_key', apiKey)
      .maybeSingle()
  ) as { data: Record<string, unknown> | null; error: { message: string } | null }
  const { data, error } = keyResult

  if (!error && data) {
    if (data.revoked_at) return { record: null, error: 'API key has been revoked', rejectionReason: 'revoked' }
    if (data.expires_at && new Date(data.expires_at as string) < new Date()) {
      return { record: null, error: 'API key has expired', rejectionReason: 'expired' }
    }
    if (!data.is_active) return { record: null, error: 'API key is inactive', rejectionReason: 'inactive' }

    // Fire-and-forget — .then() ensures the request actually dispatches (Supabase builders are thenables, not eager Promises)
    admin.from('integration_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => {}, () => {})

    const record = data as unknown as ApiKeyRecord
    setCachedKey(apiKey, record)
    return { record, error: null }
  }

  // ── 2. Try website_integrations — accepts any key prefix (gs_live_, gsk_, gilaf_, etc.) ──
  const webResult = await withRetry(() =>
    admin
      .from('website_integrations')
      .select('id, user_id, website_api_key, website_secret, status')
      .eq('website_api_key', apiKey)
      .maybeSingle()
  ) as { data: Record<string, unknown> | null; error: { message: string } | null }
  const { data: webData, error: webError } = webResult

  if (!webError && webData) {
    if (webData.status === 'disabled') return { record: null, error: 'Integration is disabled', rejectionReason: 'inactive' }
    if (webData.status !== 'active') {
      // Fire-and-forget — .then() ensures dispatch (void would never call .then())
      admin.from('website_integrations').update({ status: 'active' }).eq('id', webData.id).then(() => {}, () => {})
    }
    const record: ApiKeyRecord = {
      id:         webData.id as string,
      user_id:    webData.user_id as string,
      api_key:    webData.website_api_key as string,
      api_secret: webData.website_secret as string,
      is_bcrypt:  false,
      is_active:  true,
      revoked_at: null,
      expires_at: null,
      permissions: ['*'],
    }
    setCachedKey(apiKey, record)
    return { record, error: null }
  }

  // ── 3. Try api_keys table by SHA-256 hash (standalone keys) ──────────────────
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex')
  const hashResult = await withRetry(() =>
    admin
      .from('api_keys')
      .select('id, user_id, status, expires_at')
      .eq('key_hash', keyHash)
      .maybeSingle()
  ) as { data: Record<string, unknown> | null; error: { message: string } | null }
  const { data: hashData } = hashResult

  if (hashData) {
    if (hashData.status === 'disabled' || hashData.status === 'revoked') {
      return { record: null, error: 'API key is inactive', rejectionReason: 'inactive' }
    }
    if (hashData.expires_at && new Date(hashData.expires_at as string) < new Date()) {
      return { record: null, error: 'API key has expired', rejectionReason: 'expired' }
    }
    // Fire-and-forget — .then() ensures dispatch
    admin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', hashData.id).then(() => {}, () => {})
    const record: ApiKeyRecord = {
      id:          hashData.id as string,
      user_id:     hashData.user_id as string,
      api_key:     apiKey,
      api_secret:  '',
      is_bcrypt:   false,
      is_active:   true,
      revoked_at:  null,
      expires_at:  (hashData.expires_at as string) ?? null,
      permissions: ['*'],
    }
    setCachedKey(apiKey, record)
    return { record, error: null }
  }

  return { record: null, error: 'Invalid API key', rejectionReason: 'invalid' }
}

// ── Apply rate limit for a route ──────────────────────────────────────────────
export async function applyRateLimit(
  req: NextRequest,
  apiKey: string,
  route: string,
  userId?: string,
): Promise<NextResponse | null> {
  const opts: RateLimitOptions = INTEGRATION_RATE_LIMITS[route as keyof typeof INTEGRATION_RATE_LIMITS]
    ?? { limit: 60, windowMs: 60_000 }

  const ip = getClientIP(req)

  // Per-key limit
  const keyLimit = checkRateLimit(`integration:${route}:key:${apiKey}`, opts)
  if (!keyLimit.success) {
    void logRateLimit(userId, apiKey, ip, route)
    return rateLimitResponse(keyLimit)
  }

  // Per-IP limit (2× the per-key budget across all keys from same IP)
  const ipLimit = checkRateLimit(`integration:${route}:ip:${ip}`, { limit: opts.limit * 2, windowMs: opts.windowMs })
  if (!ipLimit.success) {
    void logRateLimit(userId, apiKey, ip, route)
    return rateLimitResponse(ipLimit)
  }

  return null
}

// ── Log rate limit violation ──────────────────────────────────────────────────
async function logRateLimit(userId: string | undefined, apiKey: string, ip: string, route: string) {
  try {
    const admin = supabaseAdmin()
    await admin.from('integration_rate_limit_logs').insert({
      user_id: userId ?? null,
      api_key: apiKey.substring(0, 12) + '...',
      ip_address: ip,
      route,
      violation_type: 'rate_limit',
    })
    await admin.from('security_events').insert({
      user_id: userId ?? null,
      event_type: 'rate_limit_exceeded',
      severity: 'medium',
      ip_address: ip,
      api_key_prefix: apiKey.substring(0, 8),
      route,
      details: { route },
    })
  } catch { /* non-blocking */ }
}

// ── Log security event ─────────────────────────────────────────────────────────────────
export async function logSecurityEvent(
  eventType: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
  opts: { userId?: string; ip?: string; apiKeyPrefix?: string; route?: string; details?: Record<string, unknown> },
) {
  try {
    await supabaseAdmin().from('security_events').insert({
      user_id: opts.userId ?? null,
      event_type: eventType,
      severity,
      ip_address: opts.ip ?? null,
      api_key_prefix: opts.apiKeyPrefix ?? null,
      route: opts.route ?? null,
      details: opts.details ?? {},
    })
  } catch { /* non-blocking */ }
}

// ── Log API key validation event (audit trail) ────────────────────────────────────────
export async function logApiKeyEvent(
  eventType: 'api_key_validated' | 'api_key_rejected',
  opts: {
    userId?: string
    ip?: string
    apiKeyPrefix?: string
    route?: string
    rejectionReason?: string
    details?: Record<string, unknown>
  },
) {
  try {
    const severity = eventType === 'api_key_validated' ? 'low' : 'medium'
    await supabaseAdmin().from('security_events').insert({
      user_id:         opts.userId ?? null,
      event_type:      eventType,
      severity,
      ip_address:      opts.ip ?? null,
      api_key_prefix:  opts.apiKeyPrefix ?? null,
      route:           opts.route ?? null,
      details: {
        ...(opts.details ?? {}),
        ...(opts.rejectionReason ? { rejection_reason: opts.rejectionReason } : {}),
      },
    })
  } catch { /* non-blocking */ }
}

// ── Webhook replay protection ─────────────────────────────────────────────────
export async function checkWebhookReplay(
  apiKey: string,
  timestamp: string | null,
  bodyText: string,
): Promise<{ blocked: boolean; reason: string }> {
  if (!timestamp) {
    return { blocked: true, reason: 'Missing X-GilafStore-Timestamp header' }
  }

  const ts = parseInt(timestamp, 10)
  if (isNaN(ts)) return { blocked: true, reason: 'Invalid timestamp format' }

  const nowSec = Math.floor(Date.now() / 1000)
  const ageSec = nowSec - ts

  // Reject if older than 5 min or more than 30s in the future
  if (ageSec > 300) return { blocked: true, reason: 'Webhook timestamp too old (replay attack prevention)' }
  if (ageSec < -30) return { blocked: true, reason: 'Webhook timestamp is in the future' }

  // Build nonce = sha256(apiKey:timestamp:sha256(body))
  const bodyHash = crypto.createHash('sha256').update(bodyText).digest('hex')
  const nonce = crypto.createHash('sha256').update(`${apiKey}:${timestamp}:${bodyHash}`).digest('hex')

  const admin = supabaseAdmin()

  // Check if nonce already exists (duplicate / replay)
  const { data: existing } = await admin
    .from('integration_webhook_nonces')
    .select('id')
    .eq('nonce', nonce)
    .maybeSingle()

  if (existing) {
    return { blocked: true, reason: 'Duplicate webhook (replay attack blocked)' }
  }

  // Store nonce — expires in 10 minutes
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  await admin.from('integration_webhook_nonces').insert({ nonce, api_key: apiKey, expires_at: expiresAt })

  // Cleanup expired nonces occasionally (1-in-20 chance, non-blocking)
  if (Math.random() < 0.05) {
    // Fire-and-forget cleanup — .then() ensures dispatch
    admin.from('integration_webhook_nonces').delete().lt('expires_at', new Date().toISOString()).then(() => {}, () => {})
  }

  return { blocked: false, reason: '' }
}

// ── Standard unauthorized response ────────────────────────────────────────────
export function unauthorized(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 })
}

export function tooManyRequests(retryAfter = 60): NextResponse {
  return NextResponse.json(
    { error: 'Rate limit exceeded', retry_after_seconds: retryAfter },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  )
}
