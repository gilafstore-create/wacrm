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

  // Get the api_key record
  const { data: apiKey } = await admin
    .from('api_keys')
    .select('id, integration_id, user_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!apiKey) {
    return NextResponse.json({ error: 'API key not found' }, { status: 404 })
  }

  // If linked to an integration, fetch the raw key from website_integrations
  if (apiKey.integration_id) {
    const { data: intg } = await admin
      .from('website_integrations')
      .select('website_api_key')
      .eq('id', apiKey.integration_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (intg?.website_api_key) {
      return NextResponse.json({ full_key: intg.website_api_key })
    }
  }

  // For non-integration keys, the full key is not stored (only hash)
  return NextResponse.json(
    { error: 'Full key cannot be revealed for this key type. Use Rotate to generate a new one.' },
    { status: 400 }
  )
}
