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

    // ISSUE-002 + ISSUE-003: Fetch user_id from the key itself ΓÇö no profiles query needed
    const { data: keyRecord } = await admin
      .from('integration_keys')
      .select('id, user_id')
      .eq('api_key', apiKey)
      .eq('is_active', true)
      .maybeSingle()

    if (!keyRecord) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 403 })
    }

    // Owner is now derived from the integration key (set by migration 015)
    const ownerUserId = keyRecord.user_id

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

    // Owner resolved from integration key (ISSUE-002 ΓÇö profiles.limit(1) removed)

    // Find existing contact by phone or email
    let existingContact = null
    if (phone) {
      const cleaned = phone.replace(/[^0-9+]/g, '')
      const { data } = await admin
        .from('contacts')
        .select('*')
        .eq('user_id', ownerUserId)  // ISSUE-002
        .or(`phone.eq.${cleaned},phone.like.%${cleaned.slice(-10)}`)
        .limit(1)
        .maybeSingle()
      existingContact = data
    }

    if (!existingContact && email) {
      const { data } = await admin
        .from('contacts')
        .select('*')
        .eq('user_id', ownerUserId)  // ISSUE-002
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
      // Create new contact ΓÇö user_id from integration key (ISSUE-002)
      const { data: newContact, error } = await admin
        .from('contacts')
        .insert({
          user_id: ownerUserId,  // ISSUE-002: was owner.user_id from profiles.limit(1)
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
