import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decryptAsync } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { supabaseAdmin } from './admin-client'

// ------------------------------------------------------------
// Automation-side Meta sender.
//
// Mirrors the logic in src/app/api/whatsapp/send/route.ts but uses
// the service-role client (engine has no cookies) and accepts the
// user / conversation / contact identifiers the engine already has
// on hand. Kept here (rather than refactoring the user-facing send
// route) to avoid risk to the working manual-send path — they can
// converge in a later refactor.
// ------------------------------------------------------------

interface SendTextArgs {
  userId: string
  conversationId: string
  contactId: string
  text: string
}

interface SendTemplateArgs {
  userId: string
  conversationId: string
  contactId: string
  templateName: string
  language?: string
  params?: string[]
  headerParams?: string[]  // resolved header text variable values (e.g. customer name)
}

export async function engineSendText(args: SendTextArgs): Promise<{ whatsapp_message_id: string }> {
  return sendViaMeta({ ...args, kind: 'text' })
}

export async function engineSendTemplate(
  args: SendTemplateArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendViaMeta({ ...args, kind: 'template' })
}

type SendInput =
  | (SendTextArgs & { kind: 'text' })
  | (SendTemplateArgs & { kind: 'template' })

async function sendViaMeta(input: SendInput): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  // Scope the contact lookup by user_id. The engine uses the
  // service-role client (bypassing RLS), and the public
  // /api/automations/engine endpoint accepts contact_id from the
  // request body — without this filter, an authenticated user could
  // fire their own automations against another tenant's contact UUID
  // and send via their own WhatsApp config to that contact's phone.
  // Practical risk is low (UUIDs are unguessable) but the check is
  // cheap defense-in-depth.
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', input.contactId)
    .eq('user_id', input.userId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this user')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  // Auto-prepend Indian country code (91) for 10-digit mobile numbers.
  // GilafStore stores phone as '8825041655' (10 digits, no country code).
  // Meta API requires full international format: '918825041655'.
  // Indian mobile numbers start with 6, 7, 8, or 9.
  const phoneForMeta =
    sanitized.length === 10 && /^[6-9]/.test(sanitized) ? '91' + sanitized : sanitized
  if (!isValidE164(phoneForMeta)) {
    throw new Error(
      `contact phone invalid for Meta API: stored="${contact.phone}" normalized="${phoneForMeta}"`,
    )
  }
  console.log('[meta-send] phone:', contact.phone, '→', phoneForMeta)

  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('user_id', input.userId)
    .single()
  if (configErr || !config) {
    throw new Error('WhatsApp not configured for this account')
  }

  const accessToken = await decryptAsync(config.access_token)

  // Fetch the full template row so sendTemplateMessage can build the correct
  // components array (header + body + buttons) via buildSendComponents.
  // The legacy body-only path omits the header component, which causes
  // Meta error #132000 when the template has a TEXT header with {{1}}.
  let templateRow: Record<string, unknown> | null = null
  if (input.kind === 'template') {
    const { data } = await db
      .from('message_templates')
      .select('*')
      .eq('user_id', input.userId)
      .eq('name', input.templateName)
      .eq('language', input.language ?? 'en_US')
      .maybeSingle()
    templateRow = data
  }

  const attempt = async (phone: string): Promise<string> => {
    if (input.kind === 'template') {
      // Resolve header text: use configured headerParams first, then fall back
      // to the template's sample value so existing automations without
      // header_variables configured still send (not ideal but beats crashing).
      const sampleHeader = Array.isArray((templateRow?.sample_values as any)?.header)
        ? String((templateRow!.sample_values as any).header[0])
        : undefined
      const headerText = (input.headerParams?.[0]?.trim()) || sampleHeader

      console.log('[meta-send] sendTemplate:', {
        templateName: input.templateName,
        language: input.language,
        params: input.params,
        headerText,
        to: phone,
      })
      const r = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        templateName: input.templateName,
        language: input.language,
        template: templateRow as any,
        messageParams: {
          body: input.params ?? [],
          headerText,
        },
        params: input.params,
      })
      console.log('[meta-send] sendTemplate success, messageId:', r.messageId)
      return r.messageId
    }
    const r = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      text: input.text,
    })
    return r.messageId
  }

  // Same phone-variant retry as /api/whatsapp/send — Meta sandbox and
  // numbers registered with/without a trunk 0 both require this to
  // reliably land a message.
  const variants = phoneVariants(phoneForMeta)
  let workingPhone = phoneForMeta
  let waMessageId = ''
  let lastError: unknown = null
  for (const v of variants) {
    try {
      waMessageId = await attempt(v)
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  if (workingPhone !== sanitized) {
    await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id)
  }

  // Persist the sent message so it appears in the inbox with a real
  // Meta message id. sender_type='bot' distinguishes automation sends
  // from manual agent sends.
  const content_type = input.kind === 'template' ? 'template' : 'text'
  const content_text = input.kind === 'text' ? input.text : null
  const template_name = input.kind === 'template' ? input.templateName : null

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: input.conversationId,
    sender_type: 'bot',
    content_type,
    content_text,
    template_name,
    message_id: waMessageId,
    status: 'sent',
  })
  if (msgErr) {
    // Meta already has the message; record the DB error but don't pretend
    // the send failed. The engine wraps this in a log line.
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text:
        input.kind === 'template' ? `[template:${input.templateName}]` : input.text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.conversationId)

  return { whatsapp_message_id: waMessageId }
}
