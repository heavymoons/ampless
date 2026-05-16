# @ampless/plugin-webhook

POST ampless events to one or more external URLs.

> **Pre-release / alpha.** Breaking changes possible in any minor version until v1.0.

Runs in the **untrusted** Lambda — it makes outbound HTTPS calls and never touches AWS data, so a compromised webhook receiver can't pivot into your CMS.

## Install

```bash
npm install @ampless/plugin-webhook@alpha
```

## Configure

In `cms.config.ts`:

```ts
import webhookPlugin from '@ampless/plugin-webhook'

export default defineConfig({
  // ...
  plugins: [
    webhookPlugin({
      endpoints: [
        {
          url: 'https://example.com/hooks/ampless',
          secret: process.env.WEBHOOK_SECRET,
          events: ['content.published', 'content.unpublished', 'content.deleted'],
        },
        {
          url: 'https://discord.com/api/webhooks/.../...',
          // No secret — Discord doesn't verify signatures
          events: ['content.published'],
        },
      ],
    }),
  ],
})
```

| Option | Default | Notes |
|---|---|---|
| `endpoints[].url` | required | HTTPS endpoint to POST to |
| `endpoints[].secret` | none | When set, body is HMAC-SHA-256 signed; sent in `X-Ampless-Signature` |
| `endpoints[].events` | all `content.*` | Restrict which event types fire this endpoint |
| `endpoints[].headers` | `{}` | Extra headers merged into every request |
| `endpoints[].timeoutMs` | `5000` | Per-request timeout |
| `url` (top-level) | none | Single-endpoint shortcut, equivalent to `endpoints: [{ url, secret }]` |
| `secret` (top-level) | none | Pairs with the top-level `url` |

## Request shape

```http
POST /hooks/ampless HTTP/1.1
Host: example.com
Content-Type: application/json
X-Ampless-Event: content.published
X-Ampless-Signature: sha256=<hex>

{
  "type": "content.published",
  "payload": {
    "siteId": "default",
    "postId": "post-001",
    "slug": "hello",
    "title": "Hello",
    "status": "published",
    "publishedAt": "2026-04-30T00:00:00.000Z",
    "tags": ["intro"]
  },
  "timestamp": "2026-04-30T00:00:01.000Z"
}
```

## Verifying the signature (Node.js)

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

function verify(rawBody: string, signatureHeader: string, secret: string): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signatureHeader)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
```

Always compute the HMAC over the **raw request body** before any JSON parsing, and use a constant-time comparison.

## Retry behavior

When any endpoint returns a non-2xx response (or times out), the plugin throws. The trust-level processor Lambda re-throws to SQS, which retries the message up to 3 times before moving it to the dead-letter queue. Idempotent receivers are recommended — the same event can be delivered more than once.

## Events emitted

- `content.created` — new post (any status)
- `content.published` — status went `draft` → `published`, or a published post was inserted
- `content.unpublished` — status went `published` → `draft`, or a published post was deleted
- `content.updated` — any MODIFY (also fires alongside published/unpublished on transitions)
- `content.deleted` — post removed
