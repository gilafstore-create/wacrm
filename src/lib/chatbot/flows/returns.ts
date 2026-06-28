import type { ChatCtx } from '../sender'
import { sendText, sendButtons } from '../sender'
import { setFlowState, resetFlowState } from '../state'

const RETURN_POLICY = `📋 *Gilaf Store Return Policy*

✅ *Eligible for return if:*
• Product received is damaged or defective
• Wrong item delivered
• Product quality does not match description

❌ *Not eligible for return:*
• Opened perishable food items (honey, spices, saffron, tea)
• Items returned after 7 days of delivery
• Products without original packaging

⏱️ *Timeline:*
• Initiate return within *7 days* of delivery
• Refund processed within *5-7 business days*

📞 For assistance, use the Support option in our main menu.

Type *menu* to return to the main menu.`

const REFUND_INFO = `💰 *Refund Status*

To check your refund status, please contact us directly:

📧 Email: support@gilafstore.com
💬 WhatsApp Support: Use *Support* from the main menu

Please have your *Order Number* ready.

Refunds are typically processed within *5-7 business days* after approval.

Type *menu* to return to the main menu.`

export async function handleReturns(
  ctx: ChatCtx,
  step: string | null,
  optionId: string | undefined,
): Promise<void> {
  // ── Entry: show return options ─────────────────────────────────────────────
  if (!step || step === 'start') {
    await sendButtons(
      ctx,
      '🔄 What would you like help with regarding returns?',
      [
        { id: 'return_policy',  title: '📋 Return Policy'  },
        { id: 'return_request', title: '📝 Return Request'  },
        { id: 'refund_status',  title: '💰 Refund Status'   },
      ],
      { header: 'Returns & Refunds', footer: 'Type "menu" to go back' },
    )
    await setFlowState(ctx.userId, ctx.contactId, {
      flow: 'returns',
      step: 'waiting_selection',
      context: {},
    })
    return
  }

  // ── Handle selection ───────────────────────────────────────────────────────
  if (step === 'waiting_selection') {
    const selection = optionId ?? ''

    if (selection === 'return_policy') {
      await sendText(ctx, RETURN_POLICY)
      await resetFlowState(ctx.userId, ctx.contactId)
      return
    }

    if (selection === 'return_request') {
      await sendText(
        ctx,
        '📝 *Initiate a Return Request*\n\n'
        + 'To process your return request, please provide:\n\n'
        + '1️⃣ *Order Number* (e.g. #1234)\n'
        + '2️⃣ *Reason for return* (damaged / wrong item / quality issue)\n'
        + '3️⃣ *Photos* of the item if damaged\n\n'
        + 'Please send these details and our team will get back to you within *24 hours*.\n\n'
        + 'Alternatively, email us at *returns@gilafstore.com*\n\n'
        + 'Type *menu* to return to the main menu.',
      )
      await resetFlowState(ctx.userId, ctx.contactId)
      return
    }

    if (selection === 'refund_status') {
      await sendText(ctx, REFUND_INFO)
      await resetFlowState(ctx.userId, ctx.contactId)
      return
    }
  }
}
