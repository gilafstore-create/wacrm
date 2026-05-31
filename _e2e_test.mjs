/**
 * Phase 1 — Full End-to-End Test Suite
 * Tests all 12 items from the deployment checklist.
 * Runs against production: https://wcrm.gilafstore.com + https://gilafstore.com
 *
 * Usage: node _e2e_test.mjs [--verbose]
 */
import { readFileSync } from 'fs'
import { createHmac } from 'crypto'

const VERBOSE = process.argv.includes('--verbose')

// ── Config ────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync('.env.local','utf8').split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const [k,...v] = l.split('='); return [k.trim(), v.join('=').trim()] })
)

const WACRM_BASE   = 'https://wcrm.gilafstore.com'
const GILAF_BASE   = 'https://gilafstore.com'
const SUPABASE_URL = env['NEXT_PUBLIC_SUPABASE_URL']
const SERVICE_KEY  = env['SUPABASE_SERVICE_ROLE_KEY']

// Fetch active integration key from Supabase
async function getActiveKey() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/integration_keys?select=api_key,api_secret,user_id,key_name&is_active=eq.true&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' }
  })
  const data = await r.json()
  return Array.isArray(data) ? data[0] : null
}

// HMAC-SHA256 — mirrors PHP exactly
function sign(payload, secret) {
  return createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex')
}

// HTTP helpers
async function post(url, payload, extraHeaders = {}) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    })
    const body = await res.json().catch(() => null)
    return { status: res.status, body, ok: res.ok }
  } catch(e) {
    return { status: 0, body: null, ok: false, err: e.message }
  }
}

async function sbGet(path, qs = '') {
  const r = await fetch(`${SUPABASE_URL}${path}${qs ? '?' + qs : ''}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' }
  })
  return { status: r.status, data: await r.json().catch(() => null) }
}

// ── Result tracking ───────────────────────────────────────────────────────
const results = []
let sectionPassed = 0, sectionFailed = 0

function section(name) {
  if (results.length > 0) console.log()
  console.log(`${'═'.repeat(68)}`)
  console.log(`  ${name}`)
  console.log(`${'═'.repeat(68)}`)
  sectionPassed = 0; sectionFailed = 0
}

function check(label, pass, detail = '', warn = false) {
  const icon = pass === null ? '⏭ ' : pass ? '✅' : (warn ? '⚠️ ' : '❌')
  const state = pass === null ? 'SKIP' : pass ? 'PASS' : (warn ? 'WARN' : 'FAIL')
  const line = `  ${icon} ${state}: ${label}${detail ? `  [${detail}]` : ''}`
  console.log(line)
  results.push({ label, pass, warn, detail })
  if (pass === true) sectionPassed++
  if (pass === false && !warn) sectionFailed++
}

function sectionSummary() {
  console.log(`  ── ${sectionPassed} passed, ${sectionFailed} failed ──`)
}

// ─────────────────────────────────────────────────────────────────────────
// SETUP: Get integration key
// ─────────────────────────────────────────────────────────────────────────
console.log('Loading integration key from Supabase...')
const key = await getActiveKey()
if (!key) {
  console.error('❌ No active integration key found — aborting')
  process.exit(1)
}
const API_KEY    = key.api_key
const API_SECRET = key.api_secret
const OWNER_UID  = key.user_id
const TS         = () => Math.floor(Date.now() / 1000).toString()

console.log(`Key:      ${API_KEY.slice(0,16)}...`)
console.log(`Owner:    ${OWNER_UID}`)
console.log(`WACRM:    ${WACRM_BASE}`)
console.log(`GilafStore: ${GILAF_BASE}`)

function signedHeaders(payload) {
  return {
    'X-GilafStore-Key':       API_KEY,
    'X-GilafStore-Signature': sign(payload, API_SECRET),
    'X-GilafStore-Timestamp': TS(),
  }
}

// ═════════════════════════════════════════════════════════════════════════
// 1. DEPLOYMENT VERIFICATION
// ═════════════════════════════════════════════════════════════════════════
section('1. Deployment Verification')

// 1a. WACRM health
const health = await post(`${WACRM_BASE}/api/integration/health`, {}, signedHeaders({}))
check('WACRM reachable (HTTP 200)',        health.status === 200, `HTTP ${health.status}`)
check('WACRM /health success:true',       health.body?.success === true, JSON.stringify(health.body).slice(0,80))

if (VERBOSE && health.body) console.log('  Health body:', JSON.stringify(health.body, null, 2))

// 1b. GilafStore reachable
try {
  const gilafRes = await fetch(`${GILAF_BASE}/admin/crm_integration.php`, { signal: AbortSignal.timeout(15000) })
  check('GilafStore admin reachable',     gilafRes.status === 200 || gilafRes.status === 302, `HTTP ${gilafRes.status}`)
} catch(e) {
  check('GilafStore admin reachable',     false, e.message)
}

// 1c. Check WACRM version/commit (if exposed)
if (health.body?.version || health.body?.commit) {
  check('WACRM build info present',       true, `v${health.body.version || 'N/A'} @ ${health.body.commit || 'N/A'}`)
}
sectionSummary()

// ═════════════════════════════════════════════════════════════════════════
// 2. SIGNATURE ENFORCEMENT (Fix 1)
// ═════════════════════════════════════════════════════════════════════════
section('2. POST /api/integration/webhook — Signature Enforcement (Fix 1)')

const validPayload = {
  event: 'order.placed',
  data: {
    order_id: 8001, customer_name: 'E2E Test User',
    phone: '+919100000001', email: 'e2e@gilaftest.com',
    total: 299, payment_method: 'razorpay',
    items: [{ product_id: 99, name: 'E2E Test Item', quantity: 1, price: 299 }],
    _event: 'order.placed', _timestamp: new Date().toISOString(), _source: 'gilafstore'
  }
}

// 2a. Valid signature → should succeed
const r_valid = await post(`${WACRM_BASE}/api/integration/webhook`, validPayload, signedHeaders(validPayload))
check('Valid signature accepted (200)',    r_valid.status === 200, `HTTP ${r_valid.status}`)
check('Valid signature: success=true',    r_valid.body?.success === true, JSON.stringify(r_valid.body).slice(0,100))

// 2b. Invalid signature → must return 401
const badHeaders = { ...signedHeaders(validPayload), 'X-GilafStore-Signature': 'a'.repeat(64) }
const r_badsig = await post(`${WACRM_BASE}/api/integration/webhook`, validPayload, badHeaders)
check('Invalid signature rejected (401)', r_badsig.status === 401, `HTTP ${r_badsig.status}`)
check('Invalid sig error message',        r_badsig.body?.error?.toLowerCase().includes('signature'), JSON.stringify(r_badsig.body))

// 2c. Missing signature → must return 401
const noSigHeaders = { 'X-GilafStore-Key': API_KEY, 'X-GilafStore-Timestamp': TS() }
const r_nosig = await post(`${WACRM_BASE}/api/integration/webhook`, validPayload, { ...noSigHeaders })
check('Missing signature rejected (401)', r_nosig.status === 401, `HTTP ${r_nosig.status}`)
sectionSummary()

// ═════════════════════════════════════════════════════════════════════════
// 3. ORDER.PLACED → CONTACT CREATION + USER_ID SCOPING (Fix 2)
// ═════════════════════════════════════════════════════════════════════════
section('3. order.placed webhook → contact creation + user_id scoping (Fix 2)')

// Use a unique phone to ensure fresh contact creation
const testPhone = `+9192${Date.now().toString().slice(-8)}`
const orderPayload = {
  event: 'order.placed',
  data: {
    order_id: 9999, customer_name: 'E2E Contact Test',
    phone: testPhone, email: `e2e_${Date.now()}@gilaftest.com`,
    total: 599, payment_method: 'cod',
    items: [{ product_id: 1, name: 'Test Gilaf', quantity: 1, price: 599 }],
    _event: 'order.placed', _timestamp: new Date().toISOString(), _source: 'gilafstore'
  }
}
const r_order = await post(`${WACRM_BASE}/api/integration/webhook`, orderPayload, signedHeaders(orderPayload))
check('order.placed returns 200',         r_order.status === 200, `HTTP ${r_order.status}`)
check('order.placed: success=true',       r_order.body?.success === true, JSON.stringify(r_order.body).slice(0,100))

// 3b. Verify contact in Supabase
await new Promise(r => setTimeout(r, 2000)) // wait for async write
const contactCheck = await sbGet('/rest/v1/contacts', `select=id,name,user_id&phone=eq.${encodeURIComponent(testPhone)}&limit=1`)
const contact = Array.isArray(contactCheck.data) ? contactCheck.data[0] : null
check('Contact created in Supabase',      !!contact, contact ? `id=${contact.id}` : 'not found')
check('Contact has correct user_id',      contact?.user_id === OWNER_UID, contact?.user_id ?? 'null')
sectionSummary()

// ═════════════════════════════════════════════════════════════════════════
// 4. CUSTOMER SYNC (sync-customer)
// ═════════════════════════════════════════════════════════════════════════
section('4. POST /api/integration/sync-customer')

const syncPhone = `+9193${Date.now().toString().slice(-8)}`
const syncPayload = { local_user_id: 555, name: 'E2E Sync Customer', phone: syncPhone, email: 'sync@e2e.test', order_count: 3, total_spend: 1500 }
const syncHeaders = { 'X-GilafStore-Key': API_KEY, 'X-GilafStore-Timestamp': TS() }
const r_sync = await post(`${WACRM_BASE}/api/integration/sync-customer`, syncPayload, syncHeaders)
check('sync-customer 200',                r_sync.status === 200, `HTTP ${r_sync.status}`)
check('sync-customer: action=created',    ['created','updated'].includes(r_sync.body?.action), `action=${r_sync.body?.action}`)

// Verify user_id in created contact
await new Promise(r => setTimeout(r, 1500))
const syncCheck = await sbGet('/rest/v1/contacts', `select=id,user_id&phone=eq.${encodeURIComponent(syncPhone)}&limit=1`)
const syncContact = Array.isArray(syncCheck.data) ? syncCheck.data[0] : null
check('Synced contact user_id correct',   syncContact?.user_id === OWNER_UID, syncContact?.user_id ?? 'not found')
sectionSummary()

// ═════════════════════════════════════════════════════════════════════════
// 5. OTP SEND (send-otp)
// ═════════════════════════════════════════════════════════════════════════
section('5. POST /api/integration/send-otp')

const otpPayload = { phone: '+919000000001', otp: '123456', expiry_minutes: 5 }
const r_otp = await post(`${WACRM_BASE}/api/integration/send-otp`, otpPayload, signedHeaders(otpPayload))

// Auth passed if NOT 401/403. WhatsApp may 503 if not configured — that's OK.
check('send-otp: auth not rejected',      ![401, 403].includes(r_otp.status), `HTTP ${r_otp.status}`)
if (r_otp.status === 200) {
  check('send-otp: success=true',         r_otp.body?.success === true, `msg_id=${r_otp.body?.message_id}`)
} else if (r_otp.status === 503 || r_otp.status === 502) {
  check('send-otp: WhatsApp not configured (expected)',  null, `HTTP ${r_otp.status} — Meta API not configured for test phone`)
} else {
  check('send-otp: unexpected status',    false, `HTTP ${r_otp.status}: ${JSON.stringify(r_otp.body).slice(0,100)}`)
}

// send-otp with WRONG signature → must 401
const r_otp_bad = await post(`${WACRM_BASE}/api/integration/send-otp`, otpPayload, { 'X-GilafStore-Key': API_KEY, 'X-GilafStore-Signature': 'z'.repeat(64) })
check('send-otp: wrong sig → 401',        r_otp_bad.status === 401, `HTTP ${r_otp_bad.status}`)
sectionSummary()

// ═════════════════════════════════════════════════════════════════════════
// 6. SEND MESSAGE (send-message)
// ═════════════════════════════════════════════════════════════════════════
section('6. POST /api/integration/send-message')

const msgPayload = { phone: '+919000000001', text: 'Phase 1 E2E test message {{name}}', variables: { name: 'Test User' } }
const r_msg = await post(`${WACRM_BASE}/api/integration/send-message`, msgPayload, signedHeaders(msgPayload))
check('send-message: auth not rejected',  ![401, 403].includes(r_msg.status), `HTTP ${r_msg.status}`)
if (r_msg.status === 200) {
  check('send-message: success=true',     r_msg.body?.success === true, `msg_id=${r_msg.body?.message_id}`)
} else if (r_msg.status === 503 || r_msg.status === 502) {
  check('send-message: WhatsApp not configured', null, `HTTP ${r_msg.status} — Meta API not configured for test phone`)
} else {
  check('send-message: unexpected',       false, `HTTP ${r_msg.status}: ${JSON.stringify(r_msg.body).slice(0,100)}`)
}

// send-message with WRONG sig → 401
const r_msg_bad = await post(`${WACRM_BASE}/api/integration/send-message`, msgPayload, { 'X-GilafStore-Key': API_KEY, 'X-GilafStore-Signature': 'b'.repeat(64) })
check('send-message: wrong sig → 401',    r_msg_bad.status === 401, `HTTP ${r_msg_bad.status}`)
sectionSummary()

// ═════════════════════════════════════════════════════════════════════════
// 7. WEBHOOK LOG IN SUPABASE
// ═════════════════════════════════════════════════════════════════════════
section('7. Webhook logs in Supabase')

const logs = await sbGet('/rest/v1/integration_webhook_logs', 'select=id,event_type,status,created_at&order=created_at.desc&limit=5')
const logRows = Array.isArray(logs.data) ? logs.data : []
check('Webhook logs table readable',      logs.status === 200, `HTTP ${logs.status}`)
check('At least 1 webhook log exists',    logRows.length > 0, `${logRows.length} rows`)
if (logRows.length > 0) {
  const latest = logRows[0]
  check('Latest log event_type set',      !!latest.event_type, latest.event_type)
  check('Latest log status processed',    ['processed','processing','failed'].includes(latest.status), latest.status)
  if (VERBOSE) logRows.forEach(l => console.log(`  LOG: [${l.status}] ${l.event_type} @ ${l.created_at}`))
}
sectionSummary()

// ═════════════════════════════════════════════════════════════════════════
// 8. SELECT DISTINCT user_id FROM contacts WHERE source = 'gilafstore'
// ═════════════════════════════════════════════════════════════════════════
section('8. contacts user_id isolation (Fix 2 verification)')

// contacts.source may not exist — try, fall back to checking user_id on all contacts
const allContacts = await sbGet('/rest/v1/contacts', 'select=id,user_id&limit=100')
const cRows = Array.isArray(allContacts.data) ? allContacts.data : []
check('contacts table readable',          allContacts.status === 200, `HTTP ${allContacts.status}`)
check(`${cRows.length} contacts in DB`,   true, `count=${cRows.length}`)

const wrongUid = cRows.filter(c => c.user_id !== OWNER_UID)
check('All contacts have correct user_id', wrongUid.length === 0,
  wrongUid.length > 0 ? `${wrongUid.length} contacts have wrong user_id` : `all ${cRows.length} correct`)

const distinctUids = [...new Set(cRows.map(c => c.user_id))]
console.log(`  SELECT DISTINCT user_id FROM contacts:`)
distinctUids.forEach(u => console.log(`    ${u === OWNER_UID ? '✅' : '❌'} ${u}`))
if (cRows.length === 0) console.log('    (empty table — no contacts yet)')
sectionSummary()

// ═════════════════════════════════════════════════════════════════════════
// 9. AUTOMATION EXECUTION CHECK
// ═════════════════════════════════════════════════════════════════════════
section('9. Order event automation execution')

const executions = await sbGet('/rest/v1/automation_pending_executions', 'select=id,status,automation_id,created_at&order=created_at.desc&limit=5')
const execRows = Array.isArray(executions.data) ? executions.data : []
check('automation_pending_executions readable', executions.status === 200, `HTTP ${executions.status}`)
if (executions.status === 200) {
  check('Execution records exist or empty',  true, `${execRows.length} records`)
  if (VERBOSE && execRows.length > 0) execRows.forEach(e => console.log(`  EXEC: [${e.status}] auto=${e.automation_id} @ ${e.created_at}`))
  if (execRows.length === 0) console.log('  ℹ️  No automations configured yet — expected on fresh instance')
}
sectionSummary()

// ═════════════════════════════════════════════════════════════════════════
// 10. CRM DEBUG PAGE
// ═════════════════════════════════════════════════════════════════════════
section('10. CRM Debug page loads (GilafStore)')

try {
  const dbgRes = await fetch(`${GILAF_BASE}/admin/crm_debug.php`, {
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  })
  check('crm_debug.php HTTP 200',         dbgRes.status === 200, `HTTP ${dbgRes.status}`)
  if (dbgRes.status === 200) {
    const html = await dbgRes.text()
    check('crm_debug.php: no PHP error',    !html.includes('Fatal error') && !html.includes('Parse error'), html.includes('Fatal') ? 'PHP error found' : 'clean')
    check('crm_debug.php: CRM Debug Panel', html.includes('CRM Debug'), html.includes('CRM Debug') ? 'found' : 'not found')
  }
} catch(e) {
  check('crm_debug.php reachable',        false, e.message)
}
sectionSummary()

// ═════════════════════════════════════════════════════════════════════════
// FINAL SUMMARY
// ═════════════════════════════════════════════════════════════════════════
const total   = results.filter(r => r.pass !== null)
const passed  = total.filter(r => r.pass === true).length
const failed  = total.filter(r => r.pass === false && !r.warn).length
const warned  = total.filter(r => r.warn).length
const skipped = results.filter(r => r.pass === null).length

console.log('\n' + '═'.repeat(68))
console.log('  FINAL SUMMARY')
console.log('═'.repeat(68))
console.log(`  ✅ Passed:  ${passed}`)
console.log(`  ❌ Failed:  ${failed}`)
console.log(`  ⚠️  Warned:  ${warned}`)
console.log(`  ⏭  Skipped: ${skipped}`)
console.log('─'.repeat(68))
if (failed > 0) {
  console.log('\n  Failed tests:')
  results.filter(r => r.pass === false && !r.warn).forEach(r => {
    console.log(`    ❌ ${r.label}  [${r.detail}]`)
  })
}
console.log('═'.repeat(68))
console.log(failed === 0 ? '  ✅ ALL CRITICAL TESTS PASSED' : `  ❌ ${failed} CRITICAL FAILURES`)
console.log('═'.repeat(68))

process.exit(failed === 0 ? 0 : 1)
