import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { decryptAsync } from '@/lib/whatsapp/encryption'

/**
 * Verify the HMAC-SHA256 signature Meta attaches to webhook POSTs.
 *
 * Meta signs the raw request body with your App Secret and sends the
 * result in the `x-hub-signature-256: sha256=<hex>` header. Without
 * verification, anyone who knows our webhook URL can POST fabricated
 * status updates and drift broadcast counts arbitrarily.
 *
 * Reference:
 *   https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verify-payloads
 *
 * Secret resolution order:
 *   1. META_APP_SECRET env var (fastest, recommended for production)
 *   2. app_config table in Supabase (set via Settings → WhatsApp Config → Meta App Secret)
 *
 * Fails closed if neither source yields a secret.
 */

function computeSignature(secret: string, rawBody: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
}

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

/**
 * Synchronous verifier — uses META_APP_SECRET env var only.
 * Falls closed (returns false) if the env var is not set.
 * Use verifyMetaWebhookSignatureAsync for DB fallback.
 */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = process.env.META_APP_SECRET
  if (!secret) {
    console.error(
      '[webhook] META_APP_SECRET env var not set — falling back to DB. ' +
        'Configure it via Settings → WhatsApp Config → Meta App Secret.',
    )
    return false
  }

  if (!signatureHeader) return false
  if (!signatureHeader.startsWith('sha256=')) return false

  return timingSafeCompare(signatureHeader, computeSignature(secret, rawBody))
}

/**
 * Async verifier — checks META_APP_SECRET env var first, then falls
 * back to the encrypted secret stored in app_config via the UI.
 * Use this in the webhook route handler.
 */
export async function verifyMetaWebhookSignatureAsync(
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false

  // 1. Try env var first (no DB round-trip)
  const envSecret = process.env.META_APP_SECRET
  if (envSecret) {
    return timingSafeCompare(signatureHeader, computeSignature(envSecret, rawBody))
  }

  // 2. Fall back to DB-stored encrypted secret
  try {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data } = await admin
      .from('app_config')
      .select('value')
      .eq('key', 'meta_app_secret')
      .maybeSingle()

    if (!data?.value) {
      console.error(
        '[webhook] No Meta App Secret found in env or DB — rejecting request. ' +
          'Add it via Settings → WhatsApp Config → Meta App Secret.',
      )
      return false
    }

    const secret = await decryptAsync(data.value)
    if (!secret) return false

    return timingSafeCompare(signatureHeader, computeSignature(secret, rawBody))
  } catch (err) {
    console.error('[webhook] Failed to load Meta App Secret from DB:', err)
    return false
  }
}
