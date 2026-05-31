/**
 * GET  /api/whatsapp/config/meta-secret
 *   Returns { configured: boolean } — NEVER returns the secret value itself.
 *
 * POST /api/whatsapp/config/meta-secret
 *   Body: { meta_app_secret: string }
 *   Encrypts and stores the secret in app_config table.
 *   Also used by /api/whatsapp/config POST via internal call.
 *
 * SECURITY:
 *   - Requires authenticated session.
 *   - Secret is encrypted with ENCRYPTION_KEY before storage.
 *   - The raw secret is never returned to the client after saving.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function getAuthUser() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  return user
}

// ── GET — only reveals whether a secret is configured ──────────────────────

export async function GET() {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = adminClient()
    const { data } = await admin
      .from('app_config')
      .select('value')
      .eq('key', 'meta_app_secret')
      .maybeSingle()

    const configured = !!(data?.value && data.value.length > 0)
    return NextResponse.json({ configured })

  } catch (err) {
    console.error('[meta-secret GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ── POST — encrypt and store the secret ────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { meta_app_secret } = body

    if (!meta_app_secret || typeof meta_app_secret !== 'string' || meta_app_secret.trim().length < 8) {
      return NextResponse.json({ error: 'Invalid Meta App Secret — must be at least 8 characters.' }, { status: 400 })
    }

    // Encrypt before storing (same AES-256-GCM key used for WhatsApp tokens)
    let encrypted: string
    try {
      encrypted = encrypt(meta_app_secret.trim())
    } catch {
      return NextResponse.json({ error: 'Encryption failed — check ENCRYPTION_KEY env var.' }, { status: 500 })
    }

    const admin = adminClient()
    const { error: upsertErr } = await admin
      .from('app_config')
      .upsert(
        { key: 'meta_app_secret', value: encrypted, updated_by: user.id, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      )

    if (upsertErr) {
      // Table may not exist yet — give SQL to run
      if (upsertErr.message?.includes('does not exist')) {
        return NextResponse.json({
          error: 'app_config table not found. Run the migration SQL from Supabase Intg page.',
          migration_needed: true,
        }, { status: 500 })
      }
      return NextResponse.json({ error: upsertErr.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'Meta App Secret saved and encrypted.' })

  } catch (err) {
    console.error('[meta-secret POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ── Exported helper — called by webhook verifier ───────────────────────────

/**
 * Retrieve and decrypt the stored Meta App Secret.
 * Returns null if not configured or decryption fails.
 * Used as fallback when META_APP_SECRET env var is absent.
 */
export async function getStoredMetaAppSecret(): Promise<string | null> {
  try {
    const admin = adminClient()
    const { data } = await admin
      .from('app_config')
      .select('value')
      .eq('key', 'meta_app_secret')
      .maybeSingle()

    if (!data?.value) return null
    return decrypt(data.value)
  } catch {
    return null
  }
}
