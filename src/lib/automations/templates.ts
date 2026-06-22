import type {
  AutomationStepConfig,
  AutomationStepType,
  AutomationTriggerConfig,
  AutomationTriggerType,
} from '@/types'

export type TemplateSlug =
  | 'welcome_message'
  | 'out_of_office'
  | 'lead_qualifier'
  | 'follow_up_reminder'
  // ── E-commerce / GilafStore order templates ──
  | 'order_placed_notification'
  | 'order_confirmed_notification'
  | 'order_shipped_notification'
  | 'order_delivered_notification'
  | 'order_cancelled_notification'
  | 'payment_success_notification'
  | 'payment_failed_notification'
  | 'order_refunded_notification'
  | 'customer_welcome_notification'
  | 'customer_registered_notification'
  | 'login_otp_notification'

export interface TemplateStepSeed {
  step_type: AutomationStepType
  step_config: AutomationStepConfig
  branch?: 'yes' | 'no' | null
  /** Index (within this seed list) of the Condition parent, if nested. */
  parent_index?: number | null
}

export interface AutomationTemplateDefinition {
  slug: TemplateSlug
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: AutomationTriggerConfig
  steps: TemplateStepSeed[]
}

export const AUTOMATION_TEMPLATES = {
  welcome_message: {
    slug: 'welcome_message',
    name: 'Welcome Message',
    description: 'Auto-reply to first-time contacts with a greeting.',
    // first_inbound_message (added in PR #33) catches both brand-new
    // contacts AND manually-added/imported contacts on their first-ever
    // reply, which is what a user setting up a "welcome" automation
    // almost always wants. new_contact_created would miss the
    // manually-imported case.
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: "Hi! 👋 Thanks for reaching out. We'll get back to you shortly.",
        },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },
  out_of_office: {
    slug: 'out_of_office',
    name: 'Out of Office',
    description: 'Auto-reply during off-hours so nobody is left waiting.',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'condition',
        step_config: {
          subject: 'time_of_day',
          operand: '18:00-09:00',
        },
      },
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Thanks for your message! Our team is offline right now (9am–6pm) and will reply first thing tomorrow.",
        },
        parent_index: 0,
        branch: 'yes',
      },
    ],
  },
  lead_qualifier: {
    slug: 'lead_qualifier',
    name: 'Lead Qualifier',
    description: 'Ask qualification questions to filter inbound leads.',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['pricing', 'quote', 'buy'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Great — happy to help with pricing! Quick question: roughly how many seats are you looking for?",
        },
      },
      {
        step_type: 'wait',
        step_config: { amount: 10, unit: 'minutes' },
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
      },
    ],
  },
  follow_up_reminder: {
    slug: 'follow_up_reminder',
    name: 'Follow-up Reminder',
    description: 'Send a nudge if a contact has not replied within 24 hours.',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 1, unit: 'days' },
      },
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Just circling back — did you have any other questions for us? Happy to help!",
        },
      },
    ],
  },
}

// ── E-commerce automation template seeds ─────────────────────────────────────
//
// Variable mapping convention:
//   The engine passes the full GilafStore event payload as context.vars.
//   interpolate() resolves {{vars.order_id}} → value from vars.order_id.
//   Meta positional params ("1","2",…) are filled in numeric order from
//   cfg.variables, so {"1":"{{vars.order_id}}","2":"{{vars.total}}"} maps
//   {{1}} → order_id and {{2}} → total in the WhatsApp template body.
//
// Template names must match the approved Meta template name exactly.

Object.assign(AUTOMATION_TEMPLATES, {
  order_placed_notification: {
    slug: 'order_placed_notification',
    name: 'Order Placed Notification',
    description: 'Send order confirmation WhatsApp message when a new order is placed.',
    trigger_type: 'order_placed' as AutomationTriggerType,
    trigger_config: {},
    steps: [
      {
        step_type: 'send_template' as AutomationStepType,
        step_config: {
          template_name: 'order_confirmation',
          language: 'en_US',
          variables: {
            '1': '{{vars.order_id}}',
            '2': '{{vars.total}}',
            '3': '{{vars.customer_name}}',
          },
        },
      },
    ],
  },

  order_confirmed_notification: {
    slug: 'order_confirmed_notification',
    name: 'Order Confirmed Notification',
    description: 'Notify customer when their order is confirmed.',
    trigger_type: 'order_confirmed' as AutomationTriggerType,
    trigger_config: {},
    steps: [
      {
        step_type: 'send_template' as AutomationStepType,
        step_config: {
          template_name: 'order_confirmation',
          language: 'en_US',
          variables: {
            '1': '{{vars.order_id}}',
            '2': '{{vars.total}}',
            '3': '{{vars.customer_name}}',
          },
        },
      },
    ],
  },

  order_shipped_notification: {
    slug: 'order_shipped_notification',
    name: 'Order Shipped Notification',
    description: 'Send shipping details and tracking info when order is dispatched.',
    trigger_type: 'order_shipped' as AutomationTriggerType,
    trigger_config: {},
    steps: [
      {
        step_type: 'send_template' as AutomationStepType,
        step_config: {
          template_name: 'order_shipped',
          language: 'en_US',
          variables: {
            '1': '{{vars.order_id}}',
            '2': '{{vars.courier}}',
            '3': '{{vars.tracking_number}}',
          },
        },
      },
    ],
  },

  order_delivered_notification: {
    slug: 'order_delivered_notification',
    name: 'Order Delivered Notification',
    description: 'Notify customer when their order has been delivered.',
    trigger_type: 'order_delivered' as AutomationTriggerType,
    trigger_config: {},
    steps: [
      {
        step_type: 'send_template' as AutomationStepType,
        step_config: {
          template_name: 'order_delivered',
          language: 'en_US',
          variables: {
            '1': '{{vars.order_id}}',
            '2': '{{vars.customer_name}}',
          },
        },
      },
    ],
  },

  order_cancelled_notification: {
    slug: 'order_cancelled_notification',
    name: 'Order Cancelled Notification',
    description: 'Notify customer when their order is cancelled.',
    trigger_type: 'order_cancelled' as AutomationTriggerType,
    trigger_config: {},
    steps: [
      {
        step_type: 'send_template' as AutomationStepType,
        step_config: {
          template_name: 'order_cancelled',
          language: 'en_US',
          variables: {
            '1': '{{vars.order_id}}',
            '2': '{{vars.customer_name}}',
          },
        },
      },
    ],
  },

  payment_success_notification: {
    slug: 'payment_success_notification',
    name: 'Payment Success Notification',
    description: 'Send payment confirmation WhatsApp message after successful payment.',
    trigger_type: 'payment_success' as AutomationTriggerType,
    trigger_config: {},
    steps: [
      {
        step_type: 'send_template' as AutomationStepType,
        step_config: {
          template_name: 'payment_success',
          language: 'en_US',
          variables: {
            '1': '{{vars.order_id}}',
            '2': '{{vars.amount}}',
            '3': '{{vars.payment_method}}',
          },
        },
      },
    ],
  },

  payment_failed_notification: {
    slug: 'payment_failed_notification',
    name: 'Payment Failed Notification',
    description: 'Alert customer when their payment fails so they can retry.',
    trigger_type: 'payment_failed' as AutomationTriggerType,
    trigger_config: {},
    steps: [
      {
        step_type: 'send_template' as AutomationStepType,
        step_config: {
          template_name: 'payment_failed',
          language: 'en_US',
          variables: {
            '1': '{{vars.order_id}}',
            '2': '{{vars.amount}}',
          },
        },
      },
    ],
  },

  order_refunded_notification: {
    slug: 'order_refunded_notification',
    name: 'Order Refunded Notification',
    description: 'Notify customer when their order is refunded.',
    trigger_type: 'order_refunded' as AutomationTriggerType,
    trigger_config: {},
    steps: [
      {
        step_type: 'send_template' as AutomationStepType,
        step_config: {
          template_name: 'order_refunded',
          language: 'en_US',
          variables: {
            '1': '{{vars.order_id}}',
            '2': '{{vars.amount}}',
          },
        },
      },
    ],
  },

  customer_registered_notification: {
    slug: 'customer_registered_notification',
    name: 'Customer Registered Message',
    description: 'Send a welcome WhatsApp message when a customer registers on the store.',
    trigger_type: 'customer_registered' as AutomationTriggerType,
    trigger_config: {},
    steps: [
      {
        step_type: 'send_template' as AutomationStepType,
        step_config: {
          template_name: 'welcome_message',
          language: 'en_US',
          variables: {
            '1': '{{vars.name}}',
          },
        },
      },
    ],
  },

  login_otp_notification: {
    slug: 'login_otp_notification',
    name: 'Login OTP Message',
    description: 'Send a WhatsApp OTP to the customer when they request a login OTP.',
    trigger_type: 'login_otp' as AutomationTriggerType,
    trigger_config: {},
    steps: [
      {
        step_type: 'send_template' as AutomationStepType,
        step_config: {
          template_name: 'login_otp',
          language: 'en_US',
          variables: {
            '1': '{{vars.otp}}',
            '2': '{{vars.expiry_minutes}}',
          },
        },
      },
    ],
  },

  customer_welcome_notification: {
    slug: 'customer_welcome_notification',
    name: 'Customer Welcome Message',
    description: 'Send a welcome WhatsApp message when a new customer registers.',
    trigger_type: 'customer_created' as AutomationTriggerType,
    trigger_config: {},
    steps: [
      {
        step_type: 'send_template' as AutomationStepType,
        step_config: {
          template_name: 'welcome_message',
          language: 'en_US',
          variables: {
            '1': '{{vars.name}}',
          },
        },
      },
    ],
  },
})

export function getTemplate(slug: string): AutomationTemplateDefinition | null {
  const all = AUTOMATION_TEMPLATES as Record<string, AutomationTemplateDefinition>
  return all[slug] ?? null
}
