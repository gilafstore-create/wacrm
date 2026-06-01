/**
 * GET /api/monitoring/counters - Get live counters
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
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Requests today
  const { count: requestsToday } = await admin
    .from('api_key_usage_logs')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', today.toISOString())

  // Contacts synced today
  const { data: integrations } = await admin
    .from('website_integrations')
    .select('total_synced_contacts, total_synced_orders')
    .eq('user_id', user.id)

  const totalContacts = integrations?.reduce((sum, i) => sum + (i.total_synced_contacts || 0), 0) || 0
  const totalOrders = integrations?.reduce((sum, i) => sum + (i.total_synced_orders || 0), 0) || 0

  // Failed syncs today
  const { count: failedSyncs } = await admin
    .from('website_sync_log')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'failed')
    .gte('created_at', today.toISOString())

  // Queue size (pending webhook deliveries)
  const { count: queueSize } = await admin
    .from('website_webhook_deliveries')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')

  // Webhook events today
  const { count: webhookEvents } = await admin
    .from('website_webhook_deliveries')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', today.toISOString())

  return NextResponse.json({
    requests_today: requestsToday || 0,
    contacts_synced: totalContacts,
    orders_synced: totalOrders,
    failed_syncs: failedSyncs || 0,
    queue_size: queueSize || 0,
    webhook_events: webhookEvents || 0,
    timestamp: new Date().toISOString(),
  })
}
