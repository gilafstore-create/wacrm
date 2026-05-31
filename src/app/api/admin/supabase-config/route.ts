/**
 * GET  /api/admin/supabase-config  — return current config (secrets masked)
 * POST /api/admin/supabase-config  — save new config values to DB
 * POST /api/admin/supabase-config?action=test — test connectivity
 *
 * SECURITY:
 *  - Requires an authenticated Supabase session (middleware enforces this)
 *  - Service Role Key is NEVER returned to the client in full — only prefix shown
 *  - All writes go to the `app_config` table (server-side only, RLS-protected)
 *  - Anon key is public by design but stored consistently here
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

// ── helpers ──────────────────────────────────────────────────────────────────

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function getAuthenticatedUser() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

function maskSecret(value: string | null): string {
  if (!value || value.length < 8) return ''
  return value.substring(0, 8) + '••••••••••••••••••••••••••••••••'
}

const CONFIG_KEYS = [
  'supabase_project_url',
  'supabase_anon_key',
  'supabase_service_role_key',
  'encryption_key',
] as const

const SENSITIVE_KEYS = new Set([
  'supabase_service_role_key',
  'encryption_key',
])

// ── ensure config table exists ────────────────────────────────────────────────

async function ensureConfigTable() {
  const admin = adminClient()
  // Try a simple select — if it fails with "does not exist" we create it
  const { error } = await admin.from('app_config').select('key').limit(1)
  if (error && error.message?.includes('does not exist')) {
    await Promise.resolve(admin.rpc('create_app_config_table')).catch(() => null)
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const user = await getAuthenticatedUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = adminClient()
    const { data, error } = await admin
      .from('app_config')
      .select('key, value, updated_at')
      .in('key', CONFIG_KEYS as unknown as string[])

    if (error) {
      const empty = Object.fromEntries(CONFIG_KEYS.map(k => [k, '']))
      // 42P01 = table does not exist, 42501 = permission denied
      const isPermissionError = error.code === '42501'
      return NextResponse.json({
        success: true,
        config: empty,
        configured: false,
        migration_needed: true,
        migration_type: isPermissionError ? 'permission' : 'table_missing',
      })
    }

    // Build masked response — never return sensitive keys in full
    const config: Record<string, string> = {}
    const lastUpdated: Record<string, string> = {}

    for (const key of CONFIG_KEYS) {
      const row = data?.find(r => r.key === key)
      const rawValue = row?.value ?? ''
      config[key] = SENSITIVE_KEYS.has(key) ? maskSecret(rawValue) : rawValue
      if (row?.updated_at) lastUpdated[key] = row.updated_at
    }

    const configured = CONFIG_KEYS.some(k => {
      const row = data?.find(r => r.key === k)
      return row?.value && row.value.length > 0
    })

    return NextResponse.json({ success: true, config, lastUpdated, configured })
  } catch (err) {
    console.error('[supabase-config GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(request.url)
    const action = url.searchParams.get('action')

    const body = await request.json()

    // ── TEST CONNECTION ───────────────────────────────────────────────────────
    if (action === 'test') {
      const { project_url, anon_key, service_role_key } = body

      if (!project_url || !anon_key) {
        return NextResponse.json({ success: false, error: 'Project URL and Anon Key are required to test.' })
      }

      const checks: Record<string, boolean | string> = {}

      // 1. URL format
      checks.url_format = /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(project_url.trim())

      // 2. Anon key format (JWT)
      checks.anon_key_format = anon_key.trim().startsWith('eyJ') && anon_key.trim().split('.').length === 3

      // 3. Service role key format (if provided and not masked)
      if (service_role_key && !service_role_key.includes('••')) {
        checks.service_role_format = service_role_key.trim().startsWith('eyJ')
      }

      // 4. Live connectivity check
      try {
        const testClient = createClient(project_url.trim(), anon_key.trim())
        const { error: pingErr } = await testClient.from('profiles').select('id').limit(1)
        checks.connectivity = !pingErr || pingErr.message.includes('permission') || pingErr.message.includes('RLS')
          ? true
          : `Failed: ${pingErr.message}`
      } catch (e) {
        checks.connectivity = `Exception: ${e instanceof Error ? e.message : 'unknown'}`
      }

      const allPassed = Object.values(checks).every(v => v === true)
      return NextResponse.json({
        success: allPassed,
        checks,
        message: allPassed ? 'All checks passed — Supabase is reachable.' : 'Some checks failed. See details.',
      })
    }

    // ── GENERATE ENCRYPTION KEY ───────────────────────────────────────────────
    if (action === 'generate-key') {
      const { project_url, anon_key, service_role_key } = body

      if (!project_url || !anon_key || !service_role_key) {
        return NextResponse.json({
          success: false,
          error: 'Project URL, Anon Key and Service Role Key are required before generating.',
        })
      }
      if (service_role_key.includes('••')) {
        return NextResponse.json({
          success: false,
          error: 'Re-enter the Service Role Key (do not use the masked value).',
        })
      }

      // Generate a cryptographically secure 64-character hex key
      // Equivalent to: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
      const encryptionKey = crypto.randomBytes(32).toString('hex')

      return NextResponse.json({ success: true, encryption_key: encryptionKey })
    }

    // ── SAVE CONFIG ───────────────────────────────────────────────────────────
    const admin = adminClient()

    const allowedKeys = new Set(CONFIG_KEYS as unknown as string[])
    const upserts: Array<{ key: string; value: string; updated_by: string; updated_at: string }> = []

    for (const [key, value] of Object.entries(body)) {
      if (!allowedKeys.has(key)) continue
      if (typeof value !== 'string') continue
      // Skip placeholder masks — don't overwrite with ••••
      if ((value as string).includes('••')) continue

      upserts.push({
        key,
        value: value.trim(),
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      })
    }

    if (upserts.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid fields to save.' })
    }

    const { error: upsertErr } = await admin
      .from('app_config')
      .upsert(upserts, { onConflict: 'key' })

    if (upsertErr) {
      // If table missing, give clear instructions
      if (upsertErr.message?.includes('does not exist')) {
        return NextResponse.json({
          success: false,
          error: 'app_config table not found. Run the migration SQL first.',
          migration_needed: true,
        })
      }
      return NextResponse.json({ success: false, error: upsertErr.message })
    }

    return NextResponse.json({ success: true, message: `${upserts.length} setting(s) saved securely.` })

  } catch (err) {
    console.error('[supabase-config POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
