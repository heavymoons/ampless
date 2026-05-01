import { createHmac } from 'node:crypto'

/**
 * HMAC SHA-256 signature in the format `sha256=<hex>`. Receivers verify
 * by recomputing the HMAC over the raw request body and constant-time
 * comparing against the header value (same conventions as GitHub
 * webhooks, Stripe, etc.).
 */
export function signPayload(secret: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}
