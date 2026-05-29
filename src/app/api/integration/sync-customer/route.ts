import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'

/**
 * POST /api/integration/sync-customer
 * Syncs customer data from GilafStore to WACRM contacts.
 */
export async function POST(request: Request) {
  try {
    const apiKey = request.headers.get('X-GilafStore-Key')
    if (!apiKey) {
      return NextResponse.json({ error: 'Missing API key' }, { status: 401 })
    }

    const admin = supabaseAdmin()

    const { data: keyRecord } = await admin
      .from('integration_keys')
      .select('id')
      .eq('api_key', apiKey)
      .eq('is_active', true)
      .maybeSingle()

    if (!keyRecord) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 403 })
    }

    const body = await request.json()
    const {
      local_user_id,
      name,
      email,
      phone,
      order_count,
      total_spend,
      last_order_date,
      created_at,
    } = body

    if (!phone && !email) {
      return NextResponse.json(
        { error: 'Either phone or email is required' },
        { status: 400 }
      )
    }

    // Get the CRM owner (first profile)
    const { data: owner } = await admin
      .from('profiles')
      .select('user_id')
      .limit(1)
      .single()

    if (!owner) {
      return NextResponse.json(
        { error: 'No CRM owner found' },
        { status: 500 }
      )
    }

    // Find existing contact by phone or email
    let existingContact = null
    if (phone) {
      const cleaned = phone.replace(/[^0-9+]/g, '')
      const { data } = await admin
        .from('contacts')
        .select('*')
        .eq('user_id', owner.user_id)
        .or(`phone.eq.${cleaned},phone.like.%${cleaned.slice(-10)}`)
        .limit(1)
        .maybeSingle()
      existingContact = data
    }

    if (!existingContact && email) {
      const { data } = await admin
        .from('contacts')
        .select('*')
        .eq('user_id', owner.user_id)
        .eq('email', email)
        .limit(1)
        .maybeSingle()
      existingContact = data
    }

    // Build metadata
    const metadata = {
      gilafstore_user_id: local_user_id,
      order_count: order_count || 0,
      total_spend: total_spend || 0,
      last_order_date: last_order_date || null,
      synced_at: new Date().toISOString(),
    }

    if (existingContact) {
      // Update existing contact
      const updates: any = {
        metadata: { ...existingContact.metadata, ...metadata },
        updated_at: new Date().toISOString(),
      }
      if (name && name !== existingContact.name) updates.name = name
      if (email && email !== existingContact.email) updates.email = email
      if (phone && phone !== existingContact.phone) updates.phone = phone

      await admin
        .from('contacts')
        .update(updates)
        .eq('id', existingContact.id)

      return NextResponse.json({
        success: true,
        contact_id: existingContact.id,
        action: 'updated',
      })
    } else {
      // Create new contact
      const { data: newContact, error } = await admin
        .from('contacts')
        .insert({
          user_id: owner.user_id,
          name: name || 'Unknown',
          phone: phone || '',
          email: email || null,
          source: 'gilafstore',
          metadata,
        })
        .select()
        .single()

      if (error) {
        console.error('[integration/sync-customer] Create failed:', error.message)
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        contact_id: newContact.id,
        action: 'created',
      })
    }
  } catch (error) {
    console.error('[integration/sync-customer] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
