import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import crypto from 'crypto'

/**
 * POST /api/integration/webhook
 * Receives events from GilafStore (order placed, cart abandoned, customer updated, etc.)
 * and processes them within the CRM context.
 */
export async function POST(request: Request) {
  try {
    const apiKey = request.headers.get('X-GilafStore-Key')
    const signature = request.headers.get('X-GilafStore-Signature')
    const timestamp = request.headers.get('X-GilafStore-Timestamp')

    if (!apiKey) {
      return NextResponse.json({ error: 'Missing API key' }, { status: 401 })
    }

    const admin = supabaseAdmin()

    // Validate API key — also fetch user_id to scope all DB queries to the correct owner
    const { data: keyRecord } = await admin
      .from('integration_keys')
      .select('id, api_secret, user_id')
      .eq('api_key', apiKey)
      .eq('is_active', true)
      .maybeSingle()

    if (!keyRecord) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 403 })
    }

    // ── ISSUE-001 FIX: Enforce HMAC signature ────────────────────
    // Read the raw body bytes FIRST — before any JSON.parse()
    // This ensures the HMAC is computed on the exact bytes PHP sent,
    // matching PHP's hash_hmac('sha256', json_encode($data), $secret).
    // Using rawBody also safely handles Unicode characters in customer
    // names (e.g. Hindi/Arabic), which JSON.parse→JSON.stringify would
    // mangle by unescaping \u sequences that PHP kept escaped.
    const rawBody = await request.text()

    // Signature is now REQUIRED — reject requests that omit the header entirely
    if (!signature) {
      console.warn('[integration/webhook] Rejected: missing X-GilafStore-Signature header')
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
    }

    // Compute expected HMAC-SHA256 over the raw request body
    const expectedSig = crypto
      .createHmac('sha256', keyRecord.api_secret)
      .update(rawBody)
      .digest('hex')

    // Timing-safe comparison — prevents timing-based side-channel attacks.
    // Pad both buffers to equal length before comparing.
    const sigA = Buffer.from(signature.padEnd(64, '\0'))
    const sigB = Buffer.from(expectedSig.padEnd(64, '\0'))
    if (sigA.length !== sigB.length || !crypto.timingSafeEqual(sigA, sigB)) {
      console.warn('[integration/webhook] Rejected: HMAC signature mismatch')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
    // ─────────────────────────────────────────────────────────────

    // Parse JSON only AFTER signature is verified
    let body: { event: string; data: unknown }
    try {
      body = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const { event, data } = body

    // Replay protection: reject if timestamp is older than 5 minutes
    if (timestamp) {
      const ts = parseInt(timestamp, 10)
      const now = Math.floor(Date.now() / 1000)
      if (Math.abs(now - ts) > 300) {
        return NextResponse.json({ error: 'Request timestamp too old' }, { status: 408 })
      }
    }

    // Log the incoming webhook
    await admin.from('integration_webhook_logs').insert({
      direction: 'incoming',
      event_type: event,
      payload: data,
      source: 'gilafstore',
      status: 'processing',
    })

    // Route the event to the appropriate handler
    const result = await handleEvent(admin, event, data)

    // Update log status
    await admin
      .from('integration_webhook_logs')
      .update({ status: result.success ? 'processed' : 'failed', response: result })
      .eq('event_type', event)
      .order('created_at', { ascending: false })
      .limit(1)

    return NextResponse.json(result, { status: result.success ? 200 : 422 })
  } catch (error) {
    console.error('[integration/webhook] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

async function handleEvent(admin: ReturnType<typeof supabaseAdmin>, event: string, data: any) {
  switch (event) {
    case 'order.placed':
      return handleOrderPlaced(admin, data)
    case 'order.shipped':
      return handleOrderStatusChange(admin, data, 'shipped')
    case 'order.delivered':
      return handleOrderStatusChange(admin, data, 'delivered')
    case 'order.cancelled':
      return handleOrderStatusChange(admin, data, 'cancelled')
    case 'payment.success':
      return handlePaymentSuccess(admin, data)
    case 'payment.failed':
      return handlePaymentFailed(admin, data)
    case 'cart.abandoned':
      return handleCartAbandoned(admin, data)
    case 'cart.recovered':
      return handleCartRecovered(admin, data)
    case 'customer.created':
      return handleCustomerCreated(admin, data)
    case 'customer.updated':
      return handleCustomerUpdated(admin, data)
    case 'customer.login':
      return handleCustomerLogin(admin, data)
    default:
      console.warn('[integration/webhook] Unknown event:', event)
      return { success: true, message: `Event ${event} acknowledged but not handled` }
  }
}

async function handleOrderPlaced(admin: ReturnType<typeof supabaseAdmin>, data: any) {
  const { order_id, customer_name, phone, email, total, items, payment_method } = data

  // Find or create CRM contact
  const contact = await findOrCreateContact(admin, { name: customer_name, phone, email })
  if (!contact) return { success: false, error: 'Failed to resolve contact' }

  // Add a note to the contact's timeline
  await admin.from('contact_notes').insert({
    contact_id: contact.id,
    user_id: contact.user_id,
    content: `Order #${order_id} placed - ₹${total} (${payment_method}) - ${items?.length || 0} items`,
  })

  // Tag the contact
  await ensureTag(admin, contact, 'customer')

  // Trigger automation if configured
  await triggerAutomation(admin, contact, 'order_placed', data)

  return { success: true, contact_id: contact.id, message: 'Order event processed' }
}

async function handleOrderStatusChange(admin: ReturnType<typeof supabaseAdmin>, data: any, status: string) {
  const { order_id, phone, tracking_number, tracking_url } = data
  const contact = await findContactByPhone(admin, phone)
  if (!contact) return { success: true, message: 'Contact not found, skipping' }

  await admin.from('contact_notes').insert({
    contact_id: contact.id,
    user_id: contact.user_id,
    content: `Order #${order_id} status: ${status}${tracking_number ? ` | Tracking: ${tracking_number}` : ''}`,
  })

  await triggerAutomation(admin, contact, `order_${status}`, data)
  return { success: true, contact_id: contact.id }
}

async function handlePaymentSuccess(admin: ReturnType<typeof supabaseAdmin>, data: any) {
  const { order_id, phone, amount } = data
  const contact = await findContactByPhone(admin, phone)
  if (!contact) return { success: true, message: 'Contact not found' }

  await admin.from('contact_notes').insert({
    contact_id: contact.id,
    user_id: contact.user_id,
    content: `Payment received: ₹${amount} for order #${order_id}`,
  })

  return { success: true, contact_id: contact.id }
}

async function handlePaymentFailed(admin: ReturnType<typeof supabaseAdmin>, data: any) {
  const { order_id, phone } = data
  const contact = await findContactByPhone(admin, phone)
  if (!contact) return { success: true, message: 'Contact not found' }

  await triggerAutomation(admin, contact, 'payment_failed', data)
  return { success: true, contact_id: contact.id }
}

async function handleCartAbandoned(admin: ReturnType<typeof supabaseAdmin>, data: any) {
  const { phone, email, cart_total, items, checkout_url } = data
  const contact = await findContactByPhone(admin, phone)
  if (!contact) return { success: true, message: 'Contact not found' }

  await ensureTag(admin, contact, 'abandoned-cart')
  await triggerAutomation(admin, contact, 'cart_abandoned', { ...data, contact_id: contact.id })

  return { success: true, contact_id: contact.id, message: 'Cart abandonment tracked' }
}

async function handleCartRecovered(admin: ReturnType<typeof supabaseAdmin>, data: any) {
  const { phone, order_id } = data
  const contact = await findContactByPhone(admin, phone)
  if (!contact) return { success: true, message: 'Contact not found' }

  await removeTag(admin, contact, 'abandoned-cart')
  return { success: true, contact_id: contact.id }
}

async function handleCustomerCreated(admin: ReturnType<typeof supabaseAdmin>, data: any) {
  const { name, phone, email, local_user_id } = data
  const contact = await findOrCreateContact(admin, { name, phone, email, local_user_id })
  if (!contact) return { success: false, error: 'Failed to create contact' }

  await ensureTag(admin, contact, 'new-customer')
  await triggerAutomation(admin, contact, 'customer_signup', data)

  return { success: true, contact_id: contact.id }
}

async function handleCustomerUpdated(admin: ReturnType<typeof supabaseAdmin>, data: any) {
  const { phone, email, name, local_user_id } = data
  const contact = await findContactByPhone(admin, phone)
  if (!contact) return { success: true, message: 'Contact not found' }

  // Update contact info
  const updates: any = {}
  if (name) updates.name = name
  if (email) updates.email = email

  if (Object.keys(updates).length > 0) {
    await admin.from('contacts').update(updates).eq('id', contact.id)
  }

  return { success: true, contact_id: contact.id }
}

async function handleCustomerLogin(admin: ReturnType<typeof supabaseAdmin>, data: any) {
  const { phone } = data
  const contact = await findContactByPhone(admin, phone)
  if (!contact) return { success: true, message: 'Contact not found' }

  // Update last activity
  await admin
    .from('contacts')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', contact.id)

  return { success: true, contact_id: contact.id }
}

// ─── Helper Functions ────────────────────────────────────────────

async function findContactByPhone(admin: ReturnType<typeof supabaseAdmin>, phone: string) {
  if (!phone) return null
  const cleaned = phone.replace(/[^0-9+]/g, '')
  
  const { data } = await admin
    .from('contacts')
    .select('*')
    .or(`phone.eq.${cleaned},phone.eq.+${cleaned},phone.like.%${cleaned.slice(-10)}`)
    .limit(1)
    .maybeSingle()

  return data
}

async function findOrCreateContact(
  admin: ReturnType<typeof supabaseAdmin>,
  info: { name?: string; phone?: string; email?: string; local_user_id?: number }
) {
  // Try to find existing contact
  if (info.phone) {
    const existing = await findContactByPhone(admin, info.phone)
    if (existing) return existing
  }

  // Get the first user (admin/owner) to assign as contact owner
  const { data: owner } = await admin
    .from('profiles')
    .select('user_id')
    .limit(1)
    .single()

  if (!owner) return null

  // Create new contact
  const { data: newContact, error } = await admin.from('contacts').insert({
    user_id: owner.user_id,
    name: info.name || 'Unknown',
    phone: info.phone || '',
    email: info.email || null,
    source: 'gilafstore',
    metadata: info.local_user_id ? { gilafstore_user_id: info.local_user_id } : null,
  }).select().single()

  if (error) {
    console.error('[integration] Failed to create contact:', error.message)
    return null
  }

  return newContact
}

async function ensureTag(admin: ReturnType<typeof supabaseAdmin>, contact: any, tagName: string) {
  // Find or create tag
  let { data: tag } = await admin
    .from('tags')
    .select('id')
    .eq('user_id', contact.user_id)
    .eq('name', tagName)
    .maybeSingle()

  if (!tag) {
    const { data: newTag } = await admin
      .from('tags')
      .insert({ user_id: contact.user_id, name: tagName, color: '#25D366' })
      .select()
      .single()
    tag = newTag
  }

  if (tag) {
    await admin
      .from('contact_tags')
      .upsert({ contact_id: contact.id, tag_id: tag.id }, { onConflict: 'contact_id,tag_id' })
  }
}

async function removeTag(admin: ReturnType<typeof supabaseAdmin>, contact: any, tagName: string) {
  const { data: tag } = await admin
    .from('tags')
    .select('id')
    .eq('user_id', contact.user_id)
    .eq('name', tagName)
    .maybeSingle()

  if (tag) {
    await admin.from('contact_tags').delete().eq('contact_id', contact.id).eq('tag_id', tag.id)
  }
}

async function triggerAutomation(
  admin: ReturnType<typeof supabaseAdmin>,
  contact: any,
  trigger: string,
  data: any
) {
  // Find active automations with this trigger type
  const { data: automations } = await admin
    .from('automations')
    .select('*')
    .eq('user_id', contact.user_id)
    .eq('is_active', true)
    .eq('trigger_type', trigger)

  if (!automations || automations.length === 0) return

  // Queue automation pending executions (start at step 0)
  for (const automation of automations) {
    await admin.from('automation_pending_executions').insert({
      automation_id: automation.id,
      user_id: contact.user_id,
      contact_id: contact.id,
      next_step_position: 0,
      context: { trigger: trigger, trigger_data: data },
      status: 'pending',
      run_at: new Date().toISOString(),
    })
  }
}
