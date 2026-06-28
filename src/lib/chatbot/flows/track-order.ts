import type { ChatCtx } from '../sender'
import { sendText, sendList } from '../sender'
import { setFlowState, resetFlowState } from '../state'
import { getOrdersByPhone, getOrderDetails } from '../gilafstore-api'

const STATUS_EMOJI: Record<string, string> = {
  pending: '🕐',
  processing: '⚙️',
  shipped: '🚚',
  delivered: '✅',
  cancelled: '❌',
  refunded: '↩️',
  'on-hold': '⏸️',
}

export async function handleTrackOrder(
  ctx: ChatCtx,
  step: string | null,
  context: Record<string, unknown>,
  optionId: string | undefined,
  messageText: string,
  contactPhone: string,
): Promise<void> {
  // ── Entry / restart ────────────────────────────────────────────────────────
  if (!step || step === 'start') {
    await sendText(ctx, '🔍 Looking up your orders...')
    const orders = await getOrdersByPhone(contactPhone)

    if (!orders.length) {
      await sendText(
        ctx,
        '😔 No orders found for this WhatsApp number.\n\n'
        + 'Please enter your *Order Number* (e.g. _#1234_) and I\'ll look it up for you, '
        + 'or type *menu* to go back.',
      )
      await setFlowState(ctx.userId, ctx.contactId, {
        flow: 'track_order',
        step: 'waiting_manual_input',
        context: {},
      })
      return
    }

    if (orders.length === 1) {
      await showOrderDetail(ctx, orders[0].order_id, orders[0].order_number)
      await resetFlowState(ctx.userId, ctx.contactId)
      return
    }

    const options = orders.slice(0, 10).map((o) => ({
      id: `order_${o.order_id}`,
      title: `Order #${o.order_number}`,
      description: `${STATUS_EMOJI[o.status.toLowerCase()] ?? '📦'} ${capitalise(o.status)} • ${o.total} ${o.currency}`,
    }))

    await sendList(ctx, '📋 Here are your recent orders. Tap one to see full details:', options, {
      header: 'Your Orders',
      footer: 'Type "menu" to go back',
      buttonText: 'Select Order',
    })
    await setFlowState(ctx.userId, ctx.contactId, {
      flow: 'track_order',
      step: 'waiting_order_select',
      context: {},
    })
    return
  }

  // ── User typed an order number manually ────────────────────────────────────
  if (step === 'waiting_manual_input') {
    const raw = messageText.replace(/[^0-9]/g, '')
    if (!raw) {
      await sendText(ctx, '⚠️ Please enter a valid order number, or type *menu* to go back.')
      return
    }
    await showOrderDetail(ctx, raw, raw)
    await resetFlowState(ctx.userId, ctx.contactId)
    return
  }

  // ── User tapped an order from the list ─────────────────────────────────────
  if (step === 'waiting_order_select' && optionId?.startsWith('order_')) {
    const orderId = optionId.replace('order_', '')
    await showOrderDetail(ctx, orderId, orderId)
    await resetFlowState(ctx.userId, ctx.contactId)
    return
  }
}

async function showOrderDetail(
  ctx: ChatCtx,
  orderId: string,
  orderNumberFallback: string,
): Promise<void> {
  const order = await getOrderDetails(orderId)
  if (!order) {
    await sendText(
      ctx,
      `❌ Could not find order #${orderNumberFallback}. Please check the number and try again, or type *menu* to go back.`,
    )
    return
  }
  const emoji = STATUS_EMOJI[order.status.toLowerCase()] ?? '📦'
  let msg = `${emoji} *Order #${order.order_number}*\n\n`
  msg += `📅 Placed: ${formatDate(order.created_at)}\n`
  msg += `📦 Status: *${capitalise(order.status)}*\n`
  msg += `🛒 Items: ${order.items}\n`
  msg += `💳 Payment: ${order.payment_method ?? 'N/A'}\n`
  msg += `💰 Total: *${order.total} ${order.currency}*`
  if (order.tracking_number) {
    msg += `\n\n🚚 Tracking: *${order.tracking_number}*`
    if (order.carrier) msg += ` (${order.carrier})`
  }
  msg += '\n\nType *menu* to return to the main menu.'
  await sendText(ctx, msg)
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}
