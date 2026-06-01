/**
 * GET /api/api-keys/:id/usage - Get usage statistics for API key
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

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const period = searchParams.get('period') || '24h'

  // Calculate period bounds
  const now = new Date()
  let periodStart: Date
  switch (period) {
    case '7d':
      periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      break
    case '30d':
      periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      break
    case '90d':
      periodStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
      break
    case '24h':
    default:
      periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      break
  }

  const admin = adminClient()

  // Verify key ownership
  const { data: key, error: keyError } = await admin
    .from('api_keys')
    .select('id, user_id')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (keyError || !key) {
    return NextResponse.json({ error: 'API key not found' }, { status: 404 })
  }

  // Get usage logs
  const { data: logs, error: logsError } = await admin
    .from('api_key_usage_logs')
    .select('endpoint, method, status_code, response_time_ms, created_at')
    .eq('key_id', params.id)
    .gte('created_at', periodStart.toISOString())
    .order('created_at', { ascending: false })
    .limit(1000)

  if (logsError) {
    return NextResponse.json({ error: logsError.message }, { status: 500 })
  }

  // Calculate statistics
  const totalRequests = logs?.length || 0
  const successfulRequests = logs?.filter(l => l.status_code >= 200 && l.status_code < 300).length || 0
  const failedRequests = logs?.filter(l => l.status_code >= 400).length || 0
  const avgResponseTime = logs?.reduce((sum, l) => sum + (l.response_time_ms || 0), 0) / (totalRequests || 1) || 0

  // Group by endpoint
  const endpointCounts: Record<string, number> = {}
  logs?.forEach(log => {
    const endpoint = log.endpoint || 'unknown'
    endpointCounts[endpoint] = (endpointCounts[endpoint] || 0) + 1
  })

  // Group by status code
  const statusCounts: Record<number, number> = {}
  logs?.forEach(log => {
    const status = log.status_code || 0
    statusCounts[status] = (statusCounts[status] || 0) + 1
  })

  // Calculate hourly trend
  const hourlyTrend: Record<string, number> = {}
  logs?.forEach(log => {
    const hour = new Date(log.created_at).toISOString().slice(0, 13) // YYYY-MM-DDTHH
    hourlyTrend[hour] = (hourlyTrend[hour] || 0) + 1
  })

  return NextResponse.json({
    period,
    period_start: periodStart.toISOString(),
    period_end: now.toISOString(),
    total_requests: totalRequests,
    successful_requests: successfulRequests,
    failed_requests: failedRequests,
    success_rate: totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0,
    avg_response_time_ms: Math.round(avgResponseTime),
    requests_by_endpoint: endpointCounts,
    requests_by_status: statusCounts,
    hourly_trend: hourlyTrend,
    top_endpoints: Object.entries(endpointCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([endpoint, count]) => ({ endpoint, count })),
  })
}
