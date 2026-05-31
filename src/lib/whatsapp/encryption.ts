import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

/**
 * WhatsApp token encryption.
 *
 * Format — GCM (current):
 *   `<iv-hex>:<ciphertext-hex>:<authTag-hex>`      (three colons)
 *
 * Format — CBC (legacy, decrypt-only):
 *   `<iv-hex>:<ciphertext-hex>`                    (one colon)
 *
 * Why GCM instead of CBC:
 *   CBC without a MAC is unauthenticated — an attacker who can write
 *   rows to `whatsapp_config` (directly, through a future RLS bug, or
 *   via a DB backup being modified) can flip bits in the ciphertext
 *   without the decrypt throwing. You'd silently get garbled tokens;
 *   worst case, if the mutated bytes happen to form a valid access
 *   token, messages go out under a spoofed account. GCM appends a
 *   16-byte authentication tag; any tampering fails the decrypt hard.
 *
 * Backward compatibility:
 *   `decrypt()` auto-detects the format by counting parts, so legacy
 *   rows keep working. New `encrypt()` output is always GCM.
 *   Existing rows can be upgraded in place by call sites that hold a
 *   Supabase client — see the `isLegacyFormat` / `encrypt` pattern in
 *   `src/app/api/whatsapp/send/route.ts`.
 */

// 12 bytes is the NIST-recommended IV length for GCM — keeps the
// counter block well below 2^32 and matches the default web-crypto
// behaviour, so any future port is straightforward.
const GCM_IV_LENGTH = 12
const CBC_IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

/**
 * Resolve the AES-256 key.
 *
 * Resolution order:
 *   1. ENCRYPTION_KEY environment variable (fast path — no DB round-trip)
 *   2. app_config table row with key = 'encryption_key'
 *      (set via Settings → Supabase Intg → Generate Key)
 *
 * Throws if neither source has a value — callers can surface a clear
 * error instead of crashing with a cryptic Buffer size mismatch.
 */
let _cachedKey: string | null = null

async function resolveEncryptionKey(): Promise<string> {
  if (process.env.ENCRYPTION_KEY) return process.env.ENCRYPTION_KEY

  if (_cachedKey) return _cachedKey

  try {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data } = await admin
      .from('app_config')
      .select('value')
      .eq('key', 'encryption_key')
      .maybeSingle()

    if (data?.value && data.value.length === 64) {
      _cachedKey = data.value
      return data.value
    }
  } catch {
    // fall through to throw
  }

  throw new Error(
    'ENCRYPTION_KEY is not set. Add it as an environment variable or generate it in Settings → Supabase Intg.',
  )
}

// Synchronous key — used by the sync encrypt/decrypt functions below.
// Falls back to _cachedKey so sync decrypt works after any async decrypt
// has already populated the cache in the same process/request.
function syncKey(): string {
  const k = process.env.ENCRYPTION_KEY || _cachedKey
  if (!k) {
    throw new Error(
      'ENCRYPTION_KEY env var is not set. Use encryptAsync/decryptAsync for DB fallback, ' +
      'or set ENCRYPTION_KEY in your Render environment variables.',
    )
  }
  return k
}

export function encrypt(text: string): string {
  const ENCRYPTION_KEY = syncKey();
  const iv = crypto.randomBytes(GCM_IV_LENGTH)
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    Buffer.from(ENCRYPTION_KEY, 'hex'),
    iv,
  )
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`
}

export function decrypt(encryptedText: string): string {
  return _decryptWithKey(encryptedText, syncKey())
}

function _decryptWithKey(encryptedText: string, ENCRYPTION_KEY: string): string {
  const parts = encryptedText.split(':')

  if (parts.length === 3) {
    // GCM — current format.
    const [ivHex, ctHex, tagHex] = parts
    const iv = Buffer.from(ivHex, 'hex')
    if (iv.length !== GCM_IV_LENGTH) {
      throw new Error(
        `Encrypted token has unexpected GCM IV length ${iv.length}`,
      )
    }
    const authTag = Buffer.from(tagHex, 'hex')
    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error(
        `Encrypted token has unexpected GCM auth-tag length ${authTag.length}`,
      )
    }
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(ENCRYPTION_KEY, 'hex'),
      iv,
    )
    decipher.setAuthTag(authTag)
    let decrypted = decipher.update(ctHex, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  }

  if (parts.length === 2) {
    // CBC — legacy. Read-only; `encrypt()` never produces this shape.
    const [ivHex, ctHex] = parts
    const iv = Buffer.from(ivHex, 'hex')
    if (iv.length !== CBC_IV_LENGTH) {
      throw new Error(
        `Encrypted token has unexpected CBC IV length ${iv.length}`,
      )
    }
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      Buffer.from(ENCRYPTION_KEY, 'hex'),
      iv,
    )
    let decrypted = decipher.update(ctHex, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  }

  throw new Error(
    `Encrypted token has unrecognised format (expected 1 or 2 colons, got ${
      parts.length - 1
    })`,
  )
}

/**
 * Async encrypt — resolves ENCRYPTION_KEY from env or DB (app_config).
 * Use in API route handlers where you can await.
 */
export async function encryptAsync(text: string): Promise<string> {
  const key = await resolveEncryptionKey()
  const iv = crypto.randomBytes(GCM_IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`
}

/**
 * Async decrypt — resolves ENCRYPTION_KEY from env or DB (app_config).
 * Use in API route handlers where you can await.
 */
export async function decryptAsync(encryptedText: string): Promise<string> {
  const key = await resolveEncryptionKey()
  return _decryptWithKey(encryptedText, key)
}

/**
 * Cheap format detector — call sites use this to decide whether to
 * write a refreshed GCM ciphertext back to the database after a
 * successful legacy decrypt. Does not attempt decryption; purely a
 * structural check.
 */
export function isLegacyFormat(encryptedText: string): boolean {
  return encryptedText.split(':').length === 2
}
