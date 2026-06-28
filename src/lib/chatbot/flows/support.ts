import { supabaseAdmin } from '@/lib/automations/admin-client'
import type { ChatCtx } from '../sender'
import { sendText, sendList } from '../sender'
import { setFlowState, resetFlowState } from '../state'

const CANNED: Record<string, string> = {
  support_order:
    '📦 *Order Issue*\n\n'
    + 'Common fixes:\n'
    + '• *Order not received?* Check tracking using the "Track Order" option\n'
    + '• *Wrong item?* Contact us with your order number and a photo\n'
    + '• *Missing item?* Reply with your order number and we\'ll investigate\n\n'
    + 'For urgent issues, tap "Human Support" from the support menu.\n\nType *menu* to go back.',

  support_payment:
    '💳 *Payment Issue*\n\n'
    + '• *Payment deducted but no order?* It can take up to 15 minutes to confirm. '
    + 'Check your email for a confirmation.\n'
    + '• *Payment failed?* Try a different card or use UPI/COD.\n'
    + '• *Duplicate charge?* Share your bank reference ID with us.\n\n'
    + 'Email: billing@gilafstore.com\n\nType *menu* to go back.',

  support_product:
    '🌿 *Product Query*\n\n'
    + '• All our products are 100% natural and lab-tested.\n'
    + '• For ingredient information, check the product page on our website.\n'
    + '• For bulk orders or wholesale, email: b2b@gilafstore.com\n\n'
    + 'Type *menu* to go back.',
}

export async function handleSupport(
  ctx: ChatCtx,
  step: string | null,
  optionId: string | undefined,
): Promise<void> {
  // ── Entry: show support categories ────────────────────────────────────────
  if (!step || step === 'start') {
    await sendList(
      ctx,
      '🎧 What kind of support do you need?',
      [
        { id: 'support_order',   title: '📦 Order Issue',      description: 'Tracking, missing items, wrong order' },
        { id: 'support_payment', title: '💳 Payment Issue',     description: 'Failed payment, refunds, charges' },
        { id: 'support_product', title: '🌿 Product Query',     description: 'Ingredients, bulk orders, quality' },
        { id: 'support_human',   title: '👤 Human Support',     description: 'Connect with our support team' },
      ],
      {
        header: 'Customer Support',
        footer: 'Type "menu" to go back',
        buttonText: 'Select Issue',
      },
    )
    await setFlowState(ctx.userId, ctx.contactId, {
      flow: 'support',
      step: 'waiting_selection',
      context: {},
    })
    return
  }

  // ── Handle selection ───────────────────────────────────────────────────────
  if (step === 'waiting_selection') {
    const selection = optionId ?? ''

    if (selection === 'support_human') {
      // Mark conversation as needing human attention
      await assignToHuman(ctx)
      await sendText(
        ctx,
        '👤 *Connecting you to our support team...*\n\n'
        + 'A team member will respond shortly. Our support hours are:\n'
        + '🕘 Mon–Sat: 9:00 AM – 6:00 PM IST\n\n'
        + 'Please describe your issue and we\'ll get back to you as soon as possible.',
      )
      await resetFlowState(ctx.userId, ctx.contactId)
      return
    }

    const response = CANNED[selection]
    if (response) {
      await sendText(ctx, response)
      await resetFlowState(ctx.userId, ctx.contactId)
      return
    }
  }
}

async function assignToHuman(ctx: ChatCtx): Promise<void> {
  try {
    await supabaseAdmin()
      .from('conversations')
      .update({
        status: 'open',
        assigned_to: null,
        last_message_text: '🎧 Customer requested human support',
        updated_at: new Date().toISOString(),
      })
      .eq('id', ctx.conversationId)
  } catch (err) {
    console.error('[chatbot:support] assignToHuman failed:', err)
  }
}
