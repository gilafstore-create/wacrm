/**
 * GET /api/monitoring/live - Get live dashboard data
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

export async function GET(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = adminClient()

  // Get last API request
  const { data: lastRequest } = await admin
    .from('api_key_usage_logs')
    .select('endpoint, method, status_code, created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Get last webhook delivery
  const { data: lastWebhook } = await admin
    .from('website_webhook_deliveries')
    .select('event_type, status, created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Get last sync
  const { data: lastSync } = await admin
    .from('website_sync_log')
    .select('sync_type, status, created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Get last order (from website_integrations)
  const { data: lastOrder } = await admin
    .from('website_integrations')
    .select('last_sync_at, total_synced_orders')
    .eq('user_id', user.id)
    .order('last_sync_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Get last contact
  const { data: lastContact } = await admin
    .from('website_integrations')
    .select('last_sync_at, total_synced_contacts')
    .eq('user_id', user.id)
    .order('last_sync_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Get last message (from contacts table)
  const { data: lastMessage } = await admin
    .from('contacts')
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    last_api_request: lastRequest || null,
    last_webhook: lastWebhook || null,
    last_sync: lastSync || null,
    last_order: lastOrder ? { synced_at: lastOrder.last_sync_at, total_orders: lastOrder.total_synced_orders } : null,
    last_contact: lastContact ? { synced_at: lastContact.last_sync_at, total_contacts: lastContact.total_synced_contacts } : null,
    last_message: lastMessage ? { created_at: lastMessage.created_at } : null,
    timestamp: new Date().toISOString(),
  })
}
