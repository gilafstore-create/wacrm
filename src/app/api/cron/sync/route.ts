/**
 * GET|POST /api/cron/sync
 *
 * External failsafe trigger for the website auto-sync scheduler. Calls
 * the exact same `tickScheduler()` the in-process loop uses, so this is
 * purely an additional way to guarantee execution — useful when Render's
 * free instance has spun down and the in-process timer was killed.
 *
 * Wire it to any of:
 *   - Render Cron Job
 *   - cron-job.org / UptimeRobot / EasyCron (hit it every minute)
 *   - A keep-alive pinger
 *
 * Auth: requires CRON_SECRET. Provide it as either
 *   - header:  Authorization: Bearer <CRON_SECRET>
 *   - header:  X-Cron-Secret: <CRON_SECRET>
 *   - query:   ?secret=<CRON_SECRET>
 *
 * If CRON_SECRET is unset the endpoint is disabled (503) — fail closed.
 */
import { NextRequest, NextResponse } from 'next/server'
import { tickScheduler } from '@/lib/integrations/scheduler'

export const dynamic = 'force-dynamic'

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const auth = request.headers.get('authorization')
  if (auth === `Bearer ${secret}`) return true
  if (request.headers.get('x-cron-secret') === secret) return true

  const qs = new URL(request.url).searchParams.get('secret')
  if (qs === secret) return true

  return false
}

async function handle(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured — endpoint disabled' },
      { status: 503 },
    )
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await tickScheduler()
  return NextResponse.json({ success: true, ...result })
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}
