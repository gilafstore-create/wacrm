/**
 * Gilaf Store WhatsApp Chatbot — Central Flow Router
 *
 * Returns `true` if the chatbot handled the message (caller should skip
 * normal automation dispatch), `false` to let automations run normally.
 */

import { getFlowState, setFlowState, resetFlowState } from './state'
import { sendMainMenu } from './flows/main-menu'
import { handleTrackOrder } from './flows/track-order'
import { handleProducts } from './flows/products'
import { handleReturns } from './flows/returns'
import { handleSupport } from './flows/support'
import { handleFeedback } from './flows/feedback'
import { handleAppStore } from './flows/app-store'
import { sendText } from './sender'

export interface ChatbotInput {
  userId: string
  contactId: string
  conversationId: string
  /** Normalized E.164 phone — used for GilafStore order lookup */
  contactPhone: string
  /** Raw inbound text (empty string for pure interactive replies) */
  messageText: string
  /** Set when inbound message is an interactive button/list reply */
  optionId?: string
}

/** Top-level menu option IDs */
const MENU_OPTION_IDS = new Set([
  'track_order', 'products', 'returns', 'support', 'feedback', 'app_store',
])

/** Sub-option prefixes the chatbot owns */
const CHATBOT_PREFIXES = ['order_', 'product_', 'cat_', 'return_', 'support_', 'rating_']

/** Greeting keywords that show the main menu */
const MENU_KEYWORDS = new Set([
  'hi', 'hello', 'hey', 'menu', 'start', '/start', 'help',
  'مرحبا', 'مرحباً', 'سلام',
])

function isChatbotOptionId(id: string): boolean {
  if (MENU_OPTION_IDS.has(id)) return true
  if (id === 'main_menu' || id === 'rating_other') return true
  return CHATBOT_PREFIXES.some((p) => id.startsWith(p))
}

export async function handleChatbotMessage(input: ChatbotInput): Promise<boolean> {
  const { userId, contactId, conversationId, contactPhone, messageText, optionId } = input
  const ctx = { userId, contactId, conversationId }
  const normalized = messageText.trim().toLowerCase()

  try {
    // ── Always return to main menu ─────────────────────────────────────────
    if (optionId === 'main_menu' || MENU_KEYWORDS.has(normalized)) {
      await sendMainMenu(ctx)
      await setFlowState(userId, contactId, { flow: 'main_menu', step: null, context: {} })
      return true
    }

    // ── Main menu taps ─────────────────────────────────────────────────────
    if (optionId && MENU_OPTION_IDS.has(optionId)) {
      await routeMenuOption(optionId, ctx, userId, contactId, contactPhone, messageText)
      return true
    }

    // ── Contact is in an active flow — route based on state ────────────────
    const state = await getFlowState(contactId)

    if (state.flow !== 'idle' && state.flow !== 'main_menu') {
      // If a chatbot-owned optionId was tapped during an active flow, handle it
      if (!optionId || isChatbotOptionId(optionId)) {
        await routeActiveFlow(state.flow, state.step, state.context, ctx, userId, contactId, contactPhone, messageText, optionId)
        return true
      }
    }

    // ── Chatbot-owned sub-option tapped while flow is idle ─────────────────
    if (optionId && isChatbotOptionId(optionId)) {
      await routeActiveFlow('idle', null, {}, ctx, userId, contactId, contactPhone, messageText, optionId)
      return true
    }

    return false // not handled — let automations run
  } catch (err) {
    console.error('[chatbot:router] unhandled error:', err)
    try {
      await sendText(ctx, '😔 Something went wrong. Please try again or type *menu* to start over.')
      await resetFlowState(userId, contactId)
    } catch { /* ignore */ }
    return true
  }
}

async function routeMenuOption(
  optionId: string,
  ctx: Parameters<typeof sendMainMenu>[0],
  userId: string,
  contactId: string,
  contactPhone: string,
  messageText: string,
): Promise<void> {
  switch (optionId) {
    case 'track_order':
      await setFlowState(userId, contactId, { flow: 'track_order', step: 'start', context: {} })
      await handleTrackOrder(ctx, 'start', {}, undefined, messageText, contactPhone)
      break
    case 'products':
      await handleProducts(ctx, 'start', {}, undefined)
      break
    case 'returns':
      await handleReturns(ctx, 'start', undefined)
      break
    case 'support':
      await handleSupport(ctx, 'start', undefined)
      break
    case 'feedback':
      await handleFeedback(ctx, 'start', {}, undefined, messageText)
      break
    case 'app_store':
      await handleAppStore(ctx)
      break
  }
}

async function routeActiveFlow(
  flow: string,
  step: string | null,
  context: Record<string, unknown>,
  ctx: Parameters<typeof sendMainMenu>[0],
  userId: string,
  contactId: string,
  contactPhone: string,
  messageText: string,
  optionId: string | undefined,
): Promise<void> {
  // If a top-level menu option was tapped during an active flow, restart that flow
  if (optionId && MENU_OPTION_IDS.has(optionId)) {
    await routeMenuOption(optionId, ctx, userId, contactId, contactPhone, messageText)
    return
  }

  switch (flow) {
    case 'track_order':
      await handleTrackOrder(ctx, step, context, optionId, messageText, contactPhone)
      break
    case 'products':
      await handleProducts(ctx, step, context, optionId)
      break
    case 'returns':
      await handleReturns(ctx, step, optionId)
      break
    case 'support':
      await handleSupport(ctx, step, optionId)
      break
    case 'feedback':
      await handleFeedback(ctx, step, context, optionId, messageText)
      break
    default:
      // Unknown active flow — show main menu
      await sendMainMenu(ctx)
      await setFlowState(userId, contactId, { flow: 'main_menu', step: null, context: {} })
  }
}
