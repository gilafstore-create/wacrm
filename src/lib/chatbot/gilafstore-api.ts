/**
 * GilafStore API client for the WhatsApp chatbot.
 * Calls /api/whatsapp_bot.php on the GilafStore website.
 * Auth: WACRM_SECRET env var (same key the integration uses).
 */

const BASE = (process.env.GILAFSTORE_API_URL ?? 'https://gilafstore.com').replace(/\/$/, '')
const SECRET = process.env.GILAFSTORE_BOT_SECRET ?? process.env.WACRM_WEBHOOK_SECRET ?? ''

export interface GilafOrder {
  order_id: string
  order_number: string
  status: string
  total: string
  currency: string
  items: string   // summary e.g. "Kashmiri Honey × 2"
  created_at: string
  tracking_number?: string
  carrier?: string
  payment_method?: string
}

export interface GilafCategory {
  id: string
  name: string
}

export interface GilafProduct {
  id: string
  name: string
  price: string
  image_url?: string
  product_url: string
  description?: string
  in_stock: boolean
}

async function call<T>(params: Record<string, string>): Promise<T | null> {
  try {
    const url = new URL(`${BASE}/api/whatsapp_bot.php`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    url.searchParams.set('secret', SECRET)
    const res = await fetch(url.toString(), { next: { revalidate: 0 } })
    if (!res.ok) {
      console.warn('[gilafstore-api] HTTP', res.status, await res.text())
      return null
    }
    const json = await res.json()
    return json as T
  } catch (err) {
    console.error('[gilafstore-api] fetch error:', err)
    return null
  }
}

export async function getOrdersByPhone(phone: string): Promise<GilafOrder[]> {
  const data = await call<{ orders: GilafOrder[] }>({ type: 'orders', phone })
  return data?.orders ?? []
}

export async function getOrderDetails(orderId: string): Promise<GilafOrder | null> {
  const data = await call<{ order: GilafOrder }>({ type: 'order_detail', order_id: orderId })
  return data?.order ?? null
}

export async function getCategories(): Promise<GilafCategory[]> {
  const data = await call<{ categories: GilafCategory[] }>({ type: 'categories' })
  return data?.categories ?? FALLBACK_CATEGORIES
}

export async function getProductsByCategory(categoryId: string): Promise<GilafProduct[]> {
  const data = await call<{ products: GilafProduct[] }>({ type: 'products', category_id: categoryId })
  return data?.products ?? []
}

// Fallback static categories if API is unreachable
const FALLBACK_CATEGORIES: GilafCategory[] = [
  { id: 'cat_honey',     name: '🍯 Honey' },
  { id: 'cat_saffron',   name: '🌺 Saffron' },
  { id: 'cat_tea',       name: '🍵 Tea' },
  { id: 'cat_spices',    name: '🌶️ Spices' },
  { id: 'cat_olive_oil', name: '🫒 Olive Oil' },
]
