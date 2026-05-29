import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'

/**
 * POST /api/integration/send-otp
 * Sends an OTP via WhatsApp template message.
 * Called by GilafStore's CRM engine.
 */
export async function POST(request: Request) {
  try {
    const apiKey = request.headers.get('X-GilafStore-Key')
    if (!apiKey) {
      return NextResponse.json({ error: 'Missing API key' }, { status: 401 })
    }

    const admin = supabaseAdmin()

    // Validate API key
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
    const { phone, otp, expiry_minutes, template } = body

    if (!phone || !otp) {
      return NextResponse.json(
        { error: 'phone and otp are required' },
        { status: 400 }
      )
    }

    // Get WhatsApp config (first active config - admin/owner)
    const { data: config } = await admin
      .from('whatsapp_config')
      .select('*')
      .limit(1)
      .single()

    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured in CRM' },
        { status: 503 }
      )
    }

    const accessToken = decrypt(config.access_token)
    const sanitizedPhone = sanitizePhoneForMeta(phone)

    // Send OTP template message
    const templateName = template || 'otp_verification'
    const params = [otp, String(expiry_minutes || 5)]

    try {
      const result = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: sanitizedPhone,
        templateName,
        params,
      })

      return NextResponse.json({
        success: true,
        message_id: result.messageId,
      })
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : 'Unknown error'
      console.error('[integration/send-otp] WhatsApp send failed:', message)

      // Fallback: try sending as plain text if template fails
      try {
        const { sendTextMessage } = await import('@/lib/whatsapp/meta-api')
        const textResult = await sendTextMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: sanitizedPhone,
          text: `Your Gilaf Store verification code is: ${otp}\n\nValid for ${expiry_minutes || 5} minutes. Do not share this code with anyone.`,
        })

        return NextResponse.json({
          success: true,
          message_id: textResult.messageId,
          fallback: true,
        })
      } catch (fallbackError) {
        const fbMsg = fallbackError instanceof Error ? fallbackError.message : 'Unknown error'
        console.error('[integration/send-otp] Fallback text send failed:', fbMsg)
        return NextResponse.json(
          { success: false, error: `WhatsApp send failed: ${message}` },
          { status: 502 }
        )
      }
    }
  } catch (error) {
    console.error('[integration/send-otp] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
