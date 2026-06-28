import { supabaseAdmin } from '@/lib/automations/admin-client'
import type { ChatCtx } from '../sender'
import { sendText, sendButtons } from '../sender'
import { setFlowState, resetFlowState } from '../state'

const RATINGS: Record<string, string> = {
  rating_1: '😞 1 Star',
  rating_2: '😐 2 Stars',
  rating_3: '🙂 3 Stars',
  rating_4: '😊 4 Stars',
  rating_5: '🤩 5 Stars',
}

export async function handleFeedback(
  ctx: ChatCtx,
  step: string | null,
  context: Record<string, unknown>,
  optionId: string | undefined,
  messageText: string,
): Promise<void> {
  // ── Entry: ask for rating ──────────────────────────────────────────────────
  if (!step || step === 'start') {
    await sendButtons(
      ctx,
      '💡 *Help Us Improve!*\n\nHow would you rate your overall experience with Gilaf Store?',
      [
        { id: 'rating_4', title: '😊 Good (4⭐)' },
        { id: 'rating_5', title: '🤩 Excellent (5⭐)' },
        { id: 'rating_other', title: '📝 Other Rating' },
      ],
      { header: 'Rate Your Experience', footer: 'Your feedback helps us improve!' },
    )
    await setFlowState(ctx.userId, ctx.contactId, {
      flow: 'feedback',
      step: 'waiting_quick_rating',
      context: {},
    })
    return
  }

  // ── User picked 4 or 5 star quick button ────────────────────────────────
  if (step === 'waiting_quick_rating') {
    if (optionId === 'rating_other') {
      await sendButtons(
        ctx,
        'Please rate your experience:',
        [
          { id: 'rating_1', title: '😞 1 Star' },
          { id: 'rating_2', title: '😐 2 Stars' },
          { id: 'rating_3', title: '🙂 3 Stars' },
        ],
        { footer: 'Type "menu" to skip' },
      )
      await setFlowState(ctx.userId, ctx.contactId, {
        flow: 'feedback',
        step: 'waiting_low_rating',
        context: {},
      })
      return
    }
    if (optionId?.startsWith('rating_')) {
      await askFeedbackText(ctx, optionId, context)
      return
    }
  }

  if (step === 'waiting_low_rating' && optionId?.startsWith('rating_')) {
    await askFeedbackText(ctx, optionId, context)
    return
  }

  // ── Capture free-text feedback ────────────────────────────────────────────
  if (step === 'waiting_feedback_text') {
    const ratingId = (context.ratingId as string) ?? ''
    const ratingNum = parseInt(ratingId.replace('rating_', ''), 10) || null
    await saveFeedback(ctx, ratingNum, messageText)

    await sendText(
      ctx,
      '🙏 *Thank you for your feedback!*\n\n'
      + 'We truly appreciate your time. Your input helps us serve you better. 🌿\n\n'
      + 'Type *menu* to return to the main menu.',
    )
    await resetFlowState(ctx.userId, ctx.contactId)
    return
  }
}

async function askFeedbackText(
  ctx: ChatCtx,
  ratingId: string,
  _context: Record<string, unknown>,
): Promise<void> {
  const label = RATINGS[ratingId] ?? ratingId
  await sendText(
    ctx,
    `Thank you for giving us ${label}! 🙏\n\nPlease share any comments or suggestions — what can we do better?`,
  )
  await setFlowState(ctx.userId, ctx.contactId, {
    flow: 'feedback',
    step: 'waiting_feedback_text',
    context: { ratingId },
  })
}

async function saveFeedback(ctx: ChatCtx, rating: number | null, text: string): Promise<void> {
  try {
    await supabaseAdmin().from('chatbot_feedback').insert({
      user_id: ctx.userId,
      contact_id: ctx.contactId,
      conversation_id: ctx.conversationId,
      rating,
      feedback_text: text.trim() || null,
    })
  } catch (err) {
    console.error('[chatbot:feedback] save failed:', err)
  }
}
