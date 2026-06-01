/**
 * Next.js instrumentation hook.
 *
 * `register()` runs ONCE per server instance, at boot — before any
 * request is handled. We use it to start the website auto-sync
 * scheduler so synchronization runs in the background independently of
 * any browser, session, or user action, and automatically resumes after
 * every Render deploy/restart (because boot re-runs this file).
 *
 * Guarded to the Node.js runtime: the edge runtime has no long-lived
 * process to host a setInterval loop.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Allow opting out (e.g. when running migrations or in CI) without
  // touching code: set DISABLE_SYNC_SCHEDULER=1.
  if (process.env.DISABLE_SYNC_SCHEDULER === '1') {
    console.log('[instrumentation] sync scheduler disabled via DISABLE_SYNC_SCHEDULER')
    return
  }

  const { startSyncScheduler } = await import('@/lib/integrations/scheduler')
  startSyncScheduler()
}
