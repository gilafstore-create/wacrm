import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { decryptAsync } from '@/lib/whatsapp/encryption'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/**
 * GET /api/whatsapp/debug
 * Returns a full diagnostic of every step that can fail during save/connect.
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail: string }> = {}

  // ── 1. Env vars ────────────────────────────────────────────────────
  checks['env.SUPABASE_URL'] = {
    ok: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    detail: process.env.NEXT_PUBLIC_SUPABASE_URL
      ? process.env.NEXT_PUBLIC_SUPABASE_URL.slice(0, 40) + '…'
      : 'MISSING',
  }
  checks['env.SUPABASE_ANON_KEY'] = {
    ok: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    detail: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'set' : 'MISSING',
  }
  checks['env.SUPABASE_SERVICE_ROLE_KEY'] = {
    ok: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    detail: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'MISSING',
  }
  checks['env.ENCRYPTION_KEY'] = {
    ok: !!process.env.ENCRYPTION_KEY,
    detail: process.env.ENCRYPTION_KEY
      ? `set (${process.env.ENCRYPTION_KEY.length} chars)`
      : 'MISSING — will fall back to DB',
  }

  // ── 2. Auth ────────────────────────────────────────────────────────
  let userId: string | null = null
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) {
      checks['auth.getUser'] = { ok: false, detail: error?.message ?? 'No user session' }
    } else {
      userId = user.id
      checks['auth.getUser'] = { ok: true, detail: `user_id: ${user.id}` }
    }
  } catch (e) {
    checks['auth.getUser'] = { ok: false, detail: String(e) }
  }

  // ── 3. app_config table (service_role) ────────────────────────────
  try {
    const { data, error } = await adminClient()
      .from('app_config')
      .select('key')
      .limit(1)
    if (error) {
      checks['db.app_config (service_role)'] = { ok: false, detail: `${error.code}: ${error.message}` }
    } else {
      checks['db.app_config (service_role)'] = { ok: true, detail: `readable, rows returned: ${data?.length ?? 0}` }
    }
  } catch (e) {
    checks['db.app_config (service_role)'] = { ok: false, detail: String(e) }
  }

  // ── 4. encryption_key in app_config ───────────────────────────────
  try {
    const { data, error } = await adminClient()
      .from('app_config')
      .select('value')
      .eq('key', 'encryption_key')
      .maybeSingle()
    if (error) {
      checks['db.encryption_key'] = { ok: false, detail: `${error.code}: ${error.message}` }
    } else if (!data?.value) {
      checks['db.encryption_key'] = { ok: false, detail: 'Not found in app_config — generate it in Supabase Intg page' }
    } else {
      checks['db.encryption_key'] = { ok: true, detail: `found, length: ${data.value.length}` }
    }
  } catch (e) {
    checks['db.encryption_key'] = { ok: false, detail: String(e) }
  }

  // ── 5. whatsapp_config table (service_role) ───────────────────────
  try {
    const { data, error } = await adminClient()
      .from('whatsapp_config')
      .select('user_id')
      .limit(1)
    if (error) {
      checks['db.whatsapp_config (service_role)'] = { ok: false, detail: `${error.code}: ${error.message}` }
    } else {
      checks['db.whatsapp_config (service_role)'] = { ok: true, detail: `readable` }
    }
  } catch (e) {
    checks['db.whatsapp_config (service_role)'] = { ok: false, detail: String(e) }
  }

  // ── 6. whatsapp_config (user session) ─────────────────────────────
  if (userId) {
    try {
      const supabase = await createClient()
      const { data, error } = await supabase
        .from('whatsapp_config')
        .select('id, phone_number_id, access_token, registered_at')
        .eq('user_id', userId)
        .maybeSingle()
      if (error) {
        checks['db.whatsapp_config (user-session)'] = { ok: false, detail: `${error.code}: ${error.message}` }
      } else if (!data) {
        checks['db.whatsapp_config (user-session)'] = { ok: true, detail: 'no row yet (first save)' }
      } else {
        checks['db.whatsapp_config (user-session)'] = {
          ok: true,
          detail: `row exists — phone_number_id: ${data.phone_number_id}, registered_at: ${data.registered_at ?? 'null'}`,
        }

        // ── 7. Decrypt stored token ──────────────────────────────────
        if (data.access_token) {
          try {
            const plain = await decryptAsync(data.access_token)
            checks['encryption.decrypt_stored_token'] = {
              ok: true,
              detail: `decrypted OK, token length: ${plain.length}`,
            }

            // ── 8. Verify with Meta ────────────────────────────────
            try {
              const info = await verifyPhoneNumber({
                phoneNumberId: data.phone_number_id,
                accessToken: plain,
              })
              checks['meta.verifyPhoneNumber'] = {
                ok: true,
                detail: `${info.display_phone_number} — ${info.verified_name ?? 'no name'}`,
              }
            } catch (e) {
              checks['meta.verifyPhoneNumber'] = { ok: false, detail: String(e) }
            }
          } catch (e) {
            checks['encryption.decrypt_stored_token'] = {
              ok: false,
              detail: `Decryption failed: ${String(e)}`,
            }
          }
        } else {
          checks['encryption.decrypt_stored_token'] = { ok: false, detail: 'access_token column is empty' }
        }
      }
    } catch (e) {
      checks['db.whatsapp_config (user-session)'] = { ok: false, detail: String(e) }
    }
  }

  // ── 8b. Schema columns check ──────────────────────────────────────
  try {
    const { error } = await adminClient()
      .from('whatsapp_config')
      .select('registered_at, subscribed_apps_at, last_registration_error')
      .limit(1)
    if (error) {
      const missingColumn = error.message.match(/'(\w+)'\s+column/)?.[1]
      checks['db.whatsapp_config.schema'] = {
        ok: false,
        detail: missingColumn
          ? `Missing column '${missingColumn}'. Run this SQL in Supabase:\n\nALTER TABLE whatsapp_config\n  ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ,\n  ADD COLUMN IF NOT EXISTS subscribed_apps_at TIMESTAMPTZ,\n  ADD COLUMN IF NOT EXISTS last_registration_error TEXT;\nNOTIFY pgrst, 'reload schema';`
          : `${error.code}: ${error.message}`,
      }
    } else {
      checks['db.whatsapp_config.schema'] = { ok: true, detail: 'all required columns present' }
    }
  } catch (e) {
    checks['db.whatsapp_config.schema'] = { ok: false, detail: String(e) }
  }

  // ── 9. INSERT permission test (simulates real save) ───────────────
  if (userId) {
    try {
      const supabase = await createClient()
      // Check existing row first
      const { data: existing } = await supabase
        .from('whatsapp_config')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle()

      if (existing) {
        // Try a no-op update on the real row
        const { error } = await supabase
          .from('whatsapp_config')
          .update({ updated_at: new Date().toISOString() })
          .eq('user_id', userId)
        if (error) {
          checks['db.whatsapp_config (write-test)'] = {
            ok: false,
            detail: `UPDATE failed [${error.code}]: ${error.message}${error.hint ? ' — hint: ' + error.hint : ''}`,
          }
        } else {
          checks['db.whatsapp_config (write-test)'] = { ok: true, detail: 'UPDATE on existing row OK' }
        }
      } else {
        // No row exists — try a real INSERT with dummy data, then immediately delete it
        const testRow = {
          user_id: userId,
          phone_number_id: '__debug_test__',
          waba_id: null,
          access_token: 'test',
          verify_token: null,
          status: 'disconnected',
        }
        const { error: insertErr } = await supabase
          .from('whatsapp_config')
          .insert(testRow)
        if (insertErr) {
          checks['db.whatsapp_config (write-test)'] = {
            ok: false,
            detail: `INSERT failed [${insertErr.code}]: ${insertErr.message}${insertErr.hint ? ' — hint: ' + insertErr.hint : ''}${insertErr.details ? ' — ' + insertErr.details : ''}`,
          }
        } else {
          // Clean up the test row
          await supabase
            .from('whatsapp_config')
            .delete()
            .eq('user_id', userId)
            .eq('phone_number_id', '__debug_test__')
          checks['db.whatsapp_config (write-test)'] = { ok: true, detail: 'INSERT permission OK (test row created and removed)' }
        }
      }
    } catch (e) {
      checks['db.whatsapp_config (write-test)'] = { ok: false, detail: String(e) }
    }
  }

  const allOk = Object.values(checks).every((c) => c.ok)

  return NextResponse.json({
    allOk,
    summary: allOk ? 'All checks passed' : 'One or more checks failed — see details below',
    checks,
    timestamp: new Date().toISOString(),
  })
}
