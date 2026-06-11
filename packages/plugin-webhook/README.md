> 日本語版: [README.ja.md](./README.ja.md)
> 

# @ampless/plugin-webhook

POST ampless events to one or more external URLs.

> **Pre-release / beta.** Breaking changes possible in any minor version until v1.0.

Runs in the **trusted** Lambda so it can access the admin-managed signing secret for zero-deploy key rotation.

## Install

```bash
npm install @ampless/plugin-webhook@beta
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

## Signing secret (admin-managed)

Since Phase 6a the webhook plugin supports an admin-managed signing secret that lets you rotate the HMAC key without redeploying.

### Setting the secret in the admin UI

1. Open `/admin/plugins/webhook` → **Secret settings**.
2. Enter your signing secret and click **Save**.
3. The new key is active within seconds — no `git push`, no Amplify rebuild.

### How the secret applies

- **Admin secret is set** → applied to **all** endpoints uniformly. This is the recommended production setup because it gives you a single place to rotate the key.
- **Admin secret is not set** → each endpoint falls back to its per-endpoint `secret` from the constructor options (see [Configure](#configure) below). Use this for initial setup before you've migrated to admin-managed.

The per-endpoint constructor `secret` is closure-private and is **never** included in the plugin manifest or any public artifact — it stays server-side by construction.

### Rotating the secret

1. Generate a new secret (e.g. `openssl rand -hex 32`).
2. Update your receiver to accept both old and new secrets for a brief window (dual-verify).
3. Paste the new secret in the admin UI → **Replace** → **Save**.
4. Once all in-flight webhooks have drained (~30 s), remove the old secret from your receiver.

### Verifying the signature on the receiver

See [Verifying the signature](#verifying-the-signature-nodejs) below for the receiver-side implementation — the verification code is identical regardless of whether the key came from the admin UI or from the constructor.

## Retry behavior

When any endpoint returns a non-2xx response (or times out), the plugin throws. The trust-level processor Lambda re-throws to SQS, which retries the message up to 3 times before moving it to the dead-letter queue. Idempotent receivers are recommended — the same event can be delivered more than once.

## Events emitted

- `content.created` — new post (any status)
- `content.published` — status went `draft` → `published`, or a published post was inserted
- `content.unpublished` — status went `published` → `draft`, or a published post was deleted
- `content.updated` — any MODIFY (also fires alongside published/unpublished on transitions)
- `content.deleted` — post removed
