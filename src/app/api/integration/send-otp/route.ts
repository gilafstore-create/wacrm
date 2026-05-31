/**
 * POST /api/integration/send-otp
 * Sends WhatsApp OTP — rate limited, user-scoped, logged
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decryptAsync } from '@/lib/whatsapp/encryption'
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'
import {
  validateApiKey, applyRateLimit, logSecurityEvent, getClientIP,
} from '@/lib/integration/middleware'

export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  try {
    const apiKey = request.headers.get('X-GilafStore-Key') ?? ''
    if (!apiKey) return NextResponse.json({ error: 'Missing API key' }, { status: 401 })

    // Rate limit — OTP is strict: 10/min per key, 20/min per IP
    const limited = await applyRateLimit(request, apiKey, 'send-otp')
    if (limited) {
      await logSecurityEvent('rate_limit_exceeded', 'medium', {
        ip, apiKeyPrefix: apiKey.substring(0, 8), route: 'send-otp',
      })
      return limited
    }

    const { record: keyRecord, error: keyError } = await validateApiKey(apiKey)
    if (keyError || !keyRecord) {
      return NextResponse.json({ error: keyError ?? 'Invalid key' }, { status: 401 })
    }

    const body = await request.json()
    const { phone, otp, template_name, variables } = body

    if (!phone || !otp) {
      return NextResponse.json({ error: 'Missing phone or otp' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin: any = supabaseAdmin()
    const ownerUserId = keyRecord.user_id

    // Get WhatsApp config
    const { data: waConfig } = await admin
      .from('whatsapp_config')
      .select('access_token, phone_number_id')
      .eq('user_id', ownerUserId)
      .maybeSingle()

    if (!waConfig) {
      return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 503 })
    }

    const accessToken = await decryptAsync(waConfig.access_token)
    const sanitizedPhone = sanitizePhoneForMeta(phone)

    // Send via Meta API
    const metaResult = await sendTemplateMessage({
      accessToken,
      phoneNumberId: waConfig.phone_number_id,
      to: sanitizedPhone,
      templateName: template_name ?? 'otp_verification',
      language: 'en',
      params: [String(otp)], // body variable {{1}}
    })

    const messageId = metaResult?.messageId ?? null
    const status = messageId ? 'sent' : 'failed'

    // Log
    void admin.from('integration_message_logs').insert({
      user_id: ownerUserId,
      phone: sanitizedPhone,
      template_name: template_name ?? 'otp_verification',
      variables: variables ?? { otp },
      message_id: messageId,
      status,
      source: 'gilafstore_otp',
    })

    if (!messageId) {
      return NextResponse.json({ success: false, error: 'WhatsApp delivery failed' }, { status: 502 })
    }

    return NextResponse.json({
      success: true,
      message_id: messageId,
      phone: sanitizedPhone,
    })

  } catch (err) {
    console.error('[integration/send-otp]', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
