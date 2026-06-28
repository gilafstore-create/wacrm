import type { AutomationTriggerType } from '@/types'

export interface TriggerMeta {
  label: string
  /** Tailwind classes for the Badge pill on the list row. */
  pillClass: string
}

export const TRIGGER_META: Record<AutomationTriggerType, TriggerMeta> = {
  new_message_received: {
    label: 'New Message',
    pillClass: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  },
  first_inbound_message: {
    label: 'First Message from Contact',
    pillClass: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
  },
  keyword_match: {
    label: 'Keyword Match',
    pillClass: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
  },
  new_contact_created: {
    label: 'New Contact',
    pillClass: 'border-primary/30 bg-primary/10 text-primary',
  },
  conversation_assigned: {
    label: 'Conversation Assigned',
    pillClass: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  },
  tag_added: {
    label: 'Tag Added',
    pillClass: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  },
  time_based: {
    label: 'Time-Based',
    pillClass: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
  },
  // ── E-commerce / integration triggers ──
  order_placed: {
    label: 'Order Placed',
    pillClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  },
  order_confirmed: {
    label: 'Order Confirmed',
    pillClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  },
  order_shipped: {
    label: 'Order Shipped',
    pillClass: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  },
  order_delivered: {
    label: 'Order Delivered',
    pillClass: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  },
  order_cancelled: {
    label: 'Order Cancelled',
    pillClass: 'border-red-500/30 bg-red-500/10 text-red-300',
  },
  order_refunded: {
    label: 'Order Refunded',
    pillClass: 'border-red-500/30 bg-red-500/10 text-red-300',
  },
  payment_success: {
    label: 'Payment Success',
    pillClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  },
  payment_failed: {
    label: 'Payment Failed',
    pillClass: 'border-red-500/30 bg-red-500/10 text-red-300',
  },
  cart_abandoned: {
    label: 'Cart Abandoned',
    pillClass: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  },
  customer_created: {
    label: 'Customer Created',
    pillClass: 'border-primary/30 bg-primary/10 text-primary',
  },
  customer_registered: {
    label: 'Customer Registered',
    pillClass: 'border-primary/30 bg-primary/10 text-primary',
  },
  login_otp: {
    label: 'Login OTP',
    pillClass: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  },
  refund_initiated: {
    label: 'Refund Initiated',
    pillClass: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
  },
  refund_completed: {
    label: 'Refund Completed',
    pillClass: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
  },
  menu_selection: {
    label: 'Menu Option Selected',
    pillClass: 'border-pink-500/30 bg-pink-500/10 text-pink-300',
  },
}

export function triggerMeta(t: AutomationTriggerType | string): TriggerMeta {
  return (
    TRIGGER_META[t as AutomationTriggerType] ?? {
      label: t,
      pillClass: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
    }
  )
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'never'
  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 60) return 'just now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  if (diffSec < 2_592_000) return `${Math.floor(diffSec / 86400)}d ago`
  return new Date(iso).toLocaleDateString()
}
