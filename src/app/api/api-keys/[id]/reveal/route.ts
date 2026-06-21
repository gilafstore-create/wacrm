/**
 * POST /api/api-keys/:id/reveal
 * Returns the full API key for integration-linked keys by reading from website_integrations.website_api_key
 * For non-integration keys, this endpoint returns an error (full key is not stored).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = adminClient()

  // Get the api_key record — we need key_prefix to match against integration keys
  const { data: apiKey } = await admin
    .from('api_keys')
    .select('id, key_prefix, user_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!apiKey) {
    return NextResponse.json({ error: 'API key not found' }, { status: 404 })
  }

  // Match by key_prefix: find integration where website_api_key starts with this prefix
  // key_prefix is like "gilaf_84a8bc4c" and website_api_key starts with "gilaf_84a8bc4c_..."
  if (apiKey.key_prefix) {
    const { data: integrations } = await admin
      .from('website_integrations')
      .select('website_api_key')
      .eq('user_id', user.id)
      .like('website_api_key', `${apiKey.key_prefix}%`)
      .limit(1)

    const fullKey = integrations?.[0]?.website_api_key
    if (fullKey) {
      return NextResponse.json({ full_key: fullKey })
    }
  }

  // Full key not stored — caller will offer rotate as fallback
  return NextResponse.json(
    { error: 'Full key not available. Use Rotate to generate a new one.' },
    { status: 400 }
  )
}
