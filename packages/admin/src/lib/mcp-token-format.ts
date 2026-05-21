/**
 * MCP API token format: `amk_` + 32 bytes of base64url randomness.
 *
 * The plaintext token is shown to the user exactly once at creation
 * time. Storage holds only the SHA-256 hash, so revealing the hash
 * doesn't compromise the live token (the prefix is shown to help the
 * user identify which token is which in the listing).
 *
 * Runs on both Node (Lambda data path) and the browser (admin UI
 * issuance). Avoid `Buffer.toString('base64url')` — Node supports it
 * natively but Next.js's `node:crypto` browser polyfill throws
 * `Unknown encoding: base64url` because its Buffer shim doesn't
 * recognise the encoding name. Encode as plain base64 then translate
 * to the URL-safe alphabet by hand; the result is byte-identical to
 * a Node base64url string.
 */
import { randomBytes, createHash } from 'node:crypto'

export interface GeneratedToken {
  /** Plaintext token. Show once, never persist. */
  plain: string
  /** SHA-256 hex of the plaintext. Used as the storage key. */
  hash: string
  /** First 8 characters of the plaintext (e.g. "amk_AbCd") for UI display. */
  prefix: string
}

export function generateToken(): GeneratedToken {
  // 32 bytes → 43 chars of URL-safe base64 (no padding).
  const random = toBase64Url(randomBytes(32))
  const plain = `amk_${random}`
  return {
    plain,
    hash: hashToken(plain),
    prefix: plain.slice(0, 8),
  }
}

export function hashToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex')
}

function toBase64Url(bytes: Buffer): string {
  return bytes
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
