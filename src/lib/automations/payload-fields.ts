/**
 * Registry of all GilafStore payload fields available for automation variable mapping.
 *
 * After `flattenGilafStorePayload()` normalises the incoming webhook, these are the
 * context.vars keys referenceable via {{key}} in step configs.
 *
 * To add a new field: append an entry here — no other code changes needed.
 * The variable mapping dropdown in the builder auto-refreshes from this list.
 */

export interface PayloadField {
  /** Variable key used in {{key}} interpolation — matches context.vars property name. */
  key: string
  /** Human-readable label shown in the variable mapping dropdown. */
  label: string
  /** Example value shown as placeholder in the UI. */
  example: string
  /**
   * Trigger types this field is relevant for.
   * Omit (undefined) to show the field for every trigger type.
   */
  triggers?: string[]
}

const ORDER_TRIGGERS = [
  'order_placed', 'order_confirmed', 'order_shipped', 'order_delivered',
  'order_cancelled', 'order_refunded', 'payment_success', 'payment_failed',
  'refund_initiated', 'refund_completed',
]

export const GILAF_PAYLOAD_FIELDS: PayloadField[] = [
  // ── Customer ──────────────────────────────────────────────────────────────
  { key: 'customer_name',    label: 'Customer Name',       example: 'Shahid Mohammad'                  },
  { key: 'customer_email',   label: 'Customer Email',      example: 'user@gilafstore.com'              },
  { key: 'customer_phone',   label: 'Customer Phone',      example: '918825041655'                     },
  // ── Order ─────────────────────────────────────────────────────────────────
  { key: 'order_id',         label: 'Order ID',            example: '99',           triggers: ORDER_TRIGGERS },
  { key: 'order_number',     label: 'Order Number',        example: '#99',          triggers: ORDER_TRIGGERS },
  { key: 'total',            label: 'Order Total (₹)',     example: '1250.00',      triggers: ORDER_TRIGGERS },
  { key: 'total_amount',     label: 'Order Amount (₹)',    example: '1250.00',      triggers: ORDER_TRIGGERS },
  { key: 'currency',         label: 'Currency',            example: 'INR',          triggers: ORDER_TRIGGERS },
  { key: 'status',           label: 'Order Status',        example: 'completed',    triggers: ORDER_TRIGGERS },
  { key: 'payment_method',   label: 'Payment Method',      example: 'razorpay',     triggers: ORDER_TRIGGERS },
  { key: 'created_at',       label: 'Order Date',          example: '2026-06-28',   triggers: ORDER_TRIGGERS },
  // ── Shipping ──────────────────────────────────────────────────────────────
  { key: 'tracking_number',  label: 'Tracking Number',     example: 'TRK123456',   triggers: ['order_shipped', 'order_delivered'] },
  { key: 'carrier',          label: 'Carrier / Courier',   example: 'BlueDart',    triggers: ['order_shipped', 'order_delivered'] },
  // ── Refund ────────────────────────────────────────────────────────────────
  { key: 'refund_amount',    label: 'Refund Amount (₹)',   example: '1250.00',     triggers: ['order_refunded', 'refund_initiated', 'refund_completed'] },
  { key: 'refund_id',        label: 'Refund ID',           example: 'REF-123',     triggers: ['order_refunded', 'refund_initiated', 'refund_completed'] },
  // ── OTP ───────────────────────────────────────────────────────────────────
  { key: 'otp_code',         label: 'OTP Code',            example: '123456',      triggers: ['login_otp'] },
  { key: 'otp_expires_at',   label: 'OTP Expiry',          example: '5 minutes',   triggers: ['login_otp'] },
  // ── Cart ──────────────────────────────────────────────────────────────────
  { key: 'cart_total',       label: 'Cart Total (₹)',      example: '850.00',      triggers: ['cart_abandoned'] },
  { key: 'cart_url',         label: 'Cart Recovery URL',   example: 'https://gilafstore.com/cart', triggers: ['cart_abandoned'] },
  // ── Interactive Menu Selection ────────────────────────────────────────────
  { key: 'option_id',        label: 'Selected Option ID',  example: 'products',                        triggers: ['menu_selection'] },
  { key: 'option_title',     label: 'Selected Option Title', example: 'Products',                      triggers: ['menu_selection'] },
  // ── General ───────────────────────────────────────────────────────────────
  { key: 'store_name',       label: 'Store Name',          example: 'Gilaf Store'                      },
]

/**
 * Returns payload fields relevant for a given trigger type.
 * Returns all fields when triggerType is undefined.
 */
export function getFieldsForTrigger(triggerType?: string): PayloadField[] {
  if (!triggerType) return GILAF_PAYLOAD_FIELDS
  return GILAF_PAYLOAD_FIELDS.filter(
    (f) => !f.triggers || f.triggers.includes(triggerType),
  )
}
