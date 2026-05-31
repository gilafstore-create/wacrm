/**
 * POST /api/integration/send-message
 * Sends a WhatsApp message (template or text) — rate limited, user-scoped
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { sendTemplateMessage, sendTextMessage, type MetaSendResult } from '@/lib/whatsapp/meta-api'
import { decryptAsync } from '@/lib/whatsapp/encryption'
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'
import { validateApiKey, applyRateLimit, getClientIP } from '@/lib/integration/middleware'

export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  try {
    const apiKey = request.headers.get('X-GilafStore-Key') ?? ''
    if (!apiKey) return NextResponse.json({ error: 'Missing API key' }, { status: 401 })

    const limited = await applyRateLimit(request, apiKey, 'send-message')
    if (limited) return limited

    const { record: keyRecord, error: keyError } = await validateApiKey(apiKey)
    if (keyError || !keyRecord) {
      return NextResponse.json({ error: keyError ?? 'Invalid key' }, { status: 401 })
    }

    const body = await request.json()
    const { phone, message, template_name, template_language, variables, type = 'text' } = body

    if (!phone) return NextResponse.json({ error: 'Missing phone' }, { status: 400 })
    if (!message && !template_name) return NextResponse.json({ error: 'Missing message or template_name' }, { status: 400 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin: any = supabaseAdmin()
    const ownerUserId = keyRecord.user_id

    const { data: waConfig } = await admin
      .from('whatsapp_config')
      .select('access_token, phone_number_id')
      .eq('user_id', ownerUserId)
      .maybeSingle()

    if (!waConfig) return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 503 })

    const accessToken = await decryptAsync(waConfig.access_token)
    const sanitizedPhone = sanitizePhoneForMeta(phone)

    let metaResult: MetaSendResult | undefined
    if (template_name) {
      metaResult = await sendTemplateMessage({
        accessToken,
        phoneNumberId: waConfig.phone_number_id,
        to: sanitizedPhone,
        templateName: template_name,
        language: template_language ?? 'en',
        params: Array.isArray(variables) ? variables.map(String) : [],
      })
    } else {
      metaResult = await sendTextMessage({
        accessToken,
        phoneNumberId: waConfig.phone_number_id,
        to: sanitizedPhone,
        text: message,
      })
    }

    const messageId = metaResult?.messageId ?? null
    const status = messageId ? 'sent' : 'failed'

    void admin.from('integration_message_logs').insert({
      user_id: ownerUserId,
      phone: sanitizedPhone,
      template_name: template_name ?? null,
      message_text: message ?? null,
      variables: variables ?? null,
      message_id: messageId,
      status,
      source: 'gilafstore',
    })

    if (!messageId) {
      return NextResponse.json({ success: false, error: 'WhatsApp delivery failed' }, { status: 502 })
    }

    return NextResponse.json({ success: true, message_id: messageId, phone: sanitizedPhone })

  } catch (err) {
    console.error('[integration/send-message]', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
