/**
 * GET /api/security/score - Get current security score
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

  // Call the calculate_security_score function
  const { data, error } = await admin.rpc('calculate_security_score')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // The function returns a setof rows, but we expect a single row
  const scoreData = Array.isArray(data) && data.length > 0 ? data[0] : data

  // Save to history
  if (scoreData) {
    await admin.from('security_score_history').insert({
      overall_score: scoreData.overall_score,
      ssl_score: scoreData.ssl_score,
      api_key_security_score: scoreData.api_key_security_score,
      webhook_validation_score: scoreData.webhook_validation_score,
      secret_rotation_score: scoreData.secret_rotation_score,
      failed_requests_score: scoreData.failed_requests_score,
      suspicious_ips_score: scoreData.suspicious_ips_score,
      rate_limit_score: scoreData.rate_limit_score,
      risk_level: scoreData.risk_level,
      risk_factors: scoreData.risk_factors,
      recommendations: scoreData.recommendations,
    })
  }

  return NextResponse.json(scoreData)
}
