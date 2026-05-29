import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { sendTemplateMessage, sendTextMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'

/**
 * POST /api/integration/send-message
 * Sends a WhatsApp message (template or text) to a phone number.
 * Used by GilafStore for order notifications, cart recovery, etc.
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
    const { phone, template_name, template_lang, variables, channel, text } = body

    if (!phone) {
      return NextResponse.json({ error: 'phone is required' }, { status: 400 })
    }

    // Get WhatsApp config
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

    let messageId = ''

    if (template_name) {
      // Build template params from variables
      const params = variables
        ? Object.values(variables).map(String)
        : []

      try {
        const result = await sendTemplateMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: sanitizedPhone,
          templateName: template_name,
          params,
        })
        messageId = result.messageId
      } catch (templateError) {
        // If template fails, try text fallback with resolved template
        const resolvedText = resolveTemplate(text || template_name, variables || {})
        try {
          const result = await sendTextMessage({
            phoneNumberId: config.phone_number_id,
            accessToken,
            to: sanitizedPhone,
            text: resolvedText,
          })
          messageId = result.messageId
        } catch (textError) {
          const msg = textError instanceof Error ? textError.message : 'Unknown error'
          return NextResponse.json(
            { success: false, error: `Send failed: ${msg}` },
            { status: 502 }
          )
        }
      }
    } else if (text) {
      // Plain text message
      const resolvedText = resolveTemplate(text, variables || {})
      try {
        const result = await sendTextMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: sanitizedPhone,
          text: resolvedText,
        })
        messageId = result.messageId
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error'
        return NextResponse.json(
          { success: false, error: `Send failed: ${msg}` },
          { status: 502 }
        )
      }
    } else {
      return NextResponse.json(
        { error: 'Either template_name or text is required' },
        { status: 400 }
      )
    }

    // Log the sent message (fire-and-forget)
    void admin.from('integration_message_logs').insert({
      phone: sanitizedPhone,
      template_name: template_name || null,
      message_text: text || null,
      variables: variables || null,
      message_id: messageId,
      status: 'sent',
      source: 'gilafstore',
    })

    return NextResponse.json({
      success: true,
      message_id: messageId,
    })
  } catch (error) {
    console.error('[integration/send-message] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Resolves {{variable}} placeholders in a template string.
 */
function resolveTemplate(template: string, variables: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] !== undefined ? String(variables[key]) : match
  })
}
