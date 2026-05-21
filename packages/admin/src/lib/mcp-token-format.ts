/**
 * MCP API token format: `amk_` + 32 bytes of base64url randomness.
 *
 * The plaintext token is shown to the user exactly once at creation
 * time. Storage holds only the SHA-256 hash, so revealing the hash
 * doesn't compromise the live token (the prefix is shown to help the
 * user identify which token is which in the listing).
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
  // 32 bytes → 43-character base64url string (no padding).
  const bytes = randomBytes(32)
  const random = bytes.toString('base64url')
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
