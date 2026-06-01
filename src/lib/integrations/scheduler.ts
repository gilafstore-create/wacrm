/**
 * Website auto-sync scheduler.
 *
 * Two trigger paths, ONE behavior — both call `tickScheduler()`:
 *
 *   1. In-process loop  — started at server boot via `instrumentation.ts`.
 *      Survives browser close, page reload, and user logout because it
 *      runs server-side, independent of any session. Resumes after a
 *      Render deploy/restart because instrumentation re-runs on boot.
 *      Ticks every TICK_MS so sub-minute intervals (down to 5s) work.
 *
 *   2. External cron    — `/api/cron/sync` (secret-protected). A failsafe
 *      for Render free-tier spin-down: an uptime pinger / Render Cron
 *      hits it to guarantee execution even if the in-process timer was
 *      killed while the instance was asleep.
 *
 * Correctness across BOTH paths (and across multiple Render workers) is
 * guaranteed by the `claim_due_website_syncs` SQL function, which uses
 * FOR UPDATE SKIP LOCKED to hand each due integration to exactly one
 * caller and reschedules it atomically before any HTTP work begins.
 */
import { syncAdminClient, runIntegrationSync, type IntegrationRow } from './sync-engine'

const TICK_MS = 5_000   // honor the 5s minimum interval
const CLAIM_LIMIT = 25  // max integrations processed per tick

export interface TickResult {
  claimed: number
  succeeded: number
  failed: number
  ranAt: string
}

let _running = false   // re-entrancy guard: never overlap two ticks
let _loopStarted = false
let _loopTimer: ReturnType<typeof setInterval> | null = null
let _lastTick: TickResult | null = null

export function getLastTick(): TickResult | null {
  return _lastTick
}

export function isLoopRunning(): boolean {
  return _loopStarted
}

/**
 * Claim all due integrations and sync them. Safe to call concurrently —
 * the DB claim makes double-execution impossible. Never throws.
 */
export async function tickScheduler(): Promise<TickResult> {
  const ranAt = new Date().toISOString()
  if (_running) {
    // A previous tick is still working (slow website). Skip this one;
    // the rows it didn't reach stay due and get picked up next tick.
    return { claimed: 0, succeeded: 0, failed: 0, ranAt }
  }
  _running = true

  let claimed = 0
  let succeeded = 0
  let failed = 0

  try {
    const admin = syncAdminClient()
    const { data: due, error } = await admin.rpc('claim_due_website_syncs', { p_limit: CLAIM_LIMIT })

    if (error) {
      console.error('[sync-scheduler] claim_due_website_syncs failed:', error.message)
      _lastTick = { claimed: 0, succeeded: 0, failed: 0, ranAt }
      return _lastTick
    }

    const rows = (due ?? []) as IntegrationRow[]
    claimed = rows.length

    for (const intg of rows) {
      const scheduledFor = ranAt
      const t0 = Date.now()
      try {
        const result = await runIntegrationSync(admin, intg, { syncType: 'auto', entityType: 'all' })
        const ok = !result.error

        await admin.from('website_integrations').update({
          last_sync_status:          ok ? 'success' : 'failed',
          last_sync_error:           result.error,
          last_sync_duration_ms:     result.durationMs,
          consecutive_sync_failures: ok ? 0 : await nextFailureCount(admin, intg.id),
        }).eq('id', intg.id)

        if (ok) succeeded++; else failed++

        // Structured log line — every requested field.
        console.log(
          `[sync-scheduler] integration=${intg.id} url=${intg.website_url} ` +
          `scheduled=${scheduledFor} ran=${new Date(t0).toISOString()} ` +
          `duration_ms=${result.durationMs} records_synced=${result.synced} ` +
          `records_failed=${result.failed} status=${ok ? 'success' : 'failed'} ` +
          `error=${result.error ?? 'none'}`,
        )
      } catch (err) {
        failed++
        const msg = err instanceof Error ? err.message : String(err)
        await admin.from('website_integrations').update({
          last_sync_status:          'failed',
          last_sync_error:           msg,
          consecutive_sync_failures: await nextFailureCount(admin, intg.id),
        }).eq('id', intg.id)
        console.error(`[sync-scheduler] integration=${intg.id} url=${intg.website_url} unhandled error:`, msg)
      }
    }
  } catch (err) {
    console.error('[sync-scheduler] tick crashed:', err)
  } finally {
    _running = false
  }

  _lastTick = { claimed, succeeded, failed, ranAt }
  return _lastTick
}

// Read current failure count and return +1 (best-effort; defaults to 1).
async function nextFailureCount(
  admin: ReturnType<typeof syncAdminClient>,
  id: string,
): Promise<number> {
  const { data } = await admin
    .from('website_integrations')
    .select('consecutive_sync_failures')
    .eq('id', id)
    .maybeSingle()
  return ((data?.consecutive_sync_failures as number) ?? 0) + 1
}

/**
 * Start the in-process tick loop. Idempotent — guarded so Next.js HMR
 * or duplicate imports can't spawn multiple timers in one process.
 * Only meaningful on the Node.js runtime (no-op on edge).
 */
export function startSyncScheduler(): void {
  if (_loopStarted) return
  _loopStarted = true

  console.log(`[sync-scheduler] in-process loop started — tick every ${TICK_MS}ms`)

  // Kick once shortly after boot so a just-restarted server resumes fast.
  setTimeout(() => { void tickScheduler() }, 2_000)

  _loopTimer = setInterval(() => { void tickScheduler() }, TICK_MS)
  // Don't keep the event loop alive purely for the timer.
  if (_loopTimer && typeof _loopTimer.unref === 'function') _loopTimer.unref()
}
