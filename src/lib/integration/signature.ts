import crypto from 'node:crypto'

/**
 * Verify the HMAC-SHA256 signature GilafStore attaches to every integration POST.
 *
 * PHP generates:
 *   hash_hmac('sha256', json_encode($data), $api_secret)
 * Header name:
 *   X-GilafStore-Signature
 *
 * We read rawBody (request.text()) BEFORE any JSON.parse() so the bytes we
 * sign are exactly what PHP signed — this also prevents Unicode mangle bugs
 * (JSON.parse → JSON.stringify can alter \u-escaped sequences PHP kept escaped).
 *
 * @param rawBody        The raw request body string (request.text())
 * @param signatureHeader The value of X-GilafStore-Signature header
 * @param apiSecret       The api_secret from integration_keys table
 * @returns true if the signature is valid
 */
export function verifyGilafStoreSignature(
  rawBody: string,
  signatureHeader: string | null,
  apiSecret: string,
): boolean {
  if (!signatureHeader || !apiSecret) return false

  const expected = crypto
    .createHmac('sha256', apiSecret)
    .update(rawBody)
    .digest('hex')

  // Pad to equal length before timing-safe compare — prevents length leak
  const minLen = Math.max(signatureHeader.length, expected.length)
  const a = Buffer.from(signatureHeader.padEnd(minLen, '\0'))
  const b = Buffer.from(expected.padEnd(minLen, '\0'))

  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
