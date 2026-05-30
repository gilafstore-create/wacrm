/**
 * POST /api/integration/sync-customer
 * Syncs GilafStore customer to WACRM contacts
 * Dedup order: local_user_id → email → phone
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'
import { validateApiKey, applyRateLimit, getClientIP } from '@/lib/integration/middleware'

export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  try {
    const apiKey = request.headers.get('X-GilafStore-Key') ?? ''
    if (!apiKey) return NextResponse.json({ error: 'Missing API key' }, { status: 401 })

    const limited = await applyRateLimit(request, apiKey, 'sync-customer')
    if (limited) return limited

    const { record: keyRecord, error: keyError } = await validateApiKey(apiKey)
    if (keyError || !keyRecord) {
      return NextResponse.json({ error: keyError ?? 'Invalid key' }, { status: 401 })
    }

    const body = await request.json()
    const { id: localUserId, name, phone, email, city, country } = body

    if (!phone && !email) {
      return NextResponse.json({ error: 'At least phone or email required' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin: any = supabaseAdmin()
    const ownerUserId = keyRecord.user_id
    const normalizedPhone = phone ? sanitizePhoneForMeta(phone) : null

    // Dedup: local_user_id → email → phone
    let existing: any = null

    if (localUserId) {
      const { data } = await admin.from('contacts').select('id, name, phone, email, external_id')
        .eq('user_id', ownerUserId).eq('external_id', String(localUserId)).maybeSingle()
      existing = data
    }
    if (!existing && email) {
      const { data } = await admin.from('contacts').select('id, name, phone, email, external_id')
        .eq('user_id', ownerUserId).eq('email', email).maybeSingle()
      existing = data
    }
    if (!existing && normalizedPhone) {
      const last10 = normalizedPhone.slice(-10)
      const { data } = await admin.from('contacts').select('id, name, phone, email, external_id')
        .eq('user_id', ownerUserId).ilike('phone', `%${last10}`).limit(1).maybeSingle()
      existing = data
    }

    if (existing) {
      // Update existing contact
      const updates: Record<string, unknown> = {}
      if (name && name !== existing.name) updates.name = name
      if (normalizedPhone && normalizedPhone !== existing.phone) updates.phone = normalizedPhone
      if (email && email !== existing.email) updates.email = email
      if (localUserId && !existing.external_id) updates.external_id = String(localUserId)
      if (city) updates.city = city

      if (Object.keys(updates).length > 0) {
        await admin.from('contacts').update(updates).eq('id', existing.id)
      }

      return NextResponse.json({ success: true, action: 'updated', contact_id: existing.id })
    }

    // Create new contact
    const { data: newContact, error: insertError } = await admin.from('contacts').insert({
      user_id: ownerUserId,
      name: name ?? normalizedPhone ?? email ?? 'Unknown',
      phone: normalizedPhone,
      email: email ?? null,
      external_id: localUserId ? String(localUserId) : null,
      city: city ?? null,
    }).select().maybeSingle()

    if (insertError) {
      return NextResponse.json({ success: false, error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, action: 'created', contact_id: newContact.id })

  } catch (err) {
    console.error('[integration/sync-customer]', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
