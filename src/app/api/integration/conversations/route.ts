/**
 * GET /api/integration/conversations
 * Fetch conversations scoped to the integration key's user
 * Query params: ?limit=50&page=1&search=&phone=
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { validateApiKey, applyRateLimit } from '@/lib/integration/middleware'

export async function GET(request: NextRequest) {
  try {
    const apiKey = request.headers.get('X-GilafStore-Key') ?? ''
    if (!apiKey) return NextResponse.json({ error: 'Missing API key' }, { status: 401 })

    const limited = await applyRateLimit(request, apiKey, 'conversations')
    if (limited) return limited

    const { record: keyRecord, error: keyError } = await validateApiKey(apiKey)
    if (keyError || !keyRecord) {
      return NextResponse.json({ error: keyError ?? 'Invalid key' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 100)
    const page  = Math.max(parseInt(searchParams.get('page') ?? '1'), 1)
    const search = searchParams.get('search') ?? ''
    const phone  = searchParams.get('phone') ?? ''
    const offset = (page - 1) * limit

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin: any = supabaseAdmin()
    const ownerUserId = keyRecord.user_id

    let query = admin
      .from('conversations')
      .select(`
        id,
        contact_id,
        last_message_at,
        unread_count,
        status,
        assigned_agent_id,
        contacts!inner (id, name, phone, email)
      `, { count: 'exact' })
      .eq('user_id', ownerUserId)
      .order('last_message_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (phone) {
      query = query.ilike('contacts.phone', `%${phone.slice(-10)}`)
    }
    if (search) {
      query = query.ilike('contacts.name', `%${search}%`)
    }

    const { data, error, count } = await query

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      conversations: data ?? [],
      total: count ?? 0,
      page,
      limit,
    })

  } catch (err) {
    console.error('[integration/conversations]', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
