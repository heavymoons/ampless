import {
  definePlugin,
  type AmplessEvent,
  type AmplessPlugin,
  type EventType,
  type TrustedPluginRuntimeContext,
} from 'ampless'
import { signPayload } from './sign.js'

export interface WebhookEndpoint {
  /** Target URL. Required. */
  url: string
  /**
   * Optional shared secret. When set, the body is HMAC-SHA-256 signed and
   * the result is sent in the `X-Ampless-Signature` header (format:
   * `sha256=<hex>`). Receivers should constant-time compare against the
   * recomputed HMAC over the raw body to authenticate.
   */
  secret?: string
  /**
   * Restrict which events fire this endpoint. Omit to receive all
   * supported event types (currently the content.* family).
   */
  events?: EventType[]
  /** Extra headers merged into every request to this endpoint. */
  headers?: Record<string, string>
  /** Per-request timeout in ms. Default 5000. */
  timeoutMs?: number
}

export interface WebhookPluginOptions {
  endpoints: WebhookEndpoint[]
}

const ALL_CONTENT_EVENTS: EventType[] = [
  'content.created',
  'content.updated',
  'content.published',
  'content.unpublished',
  'content.deleted',
]

/**
 * Webhook plugin. Posts a JSON envelope to one or more external URLs
 * whenever a subscribed event fires. Runs in the trusted Lambda so it
 * can access the admin-managed signing secret via `ctx.secret()`.
 *
 * Secret priority (per dispatch call):
 *   1. Admin-managed `signingSecret` (set from `/admin/plugins/webhook`):
 *      applied uniformly to **all** endpoints — enables zero-deploy key
 *      rotation.
 *   2. Per-endpoint `secret` from the constructor options (closure-private
 *      fallback): used when the admin secret has not been saved yet.
 *      Recommended for initial setup; rotate to admin-managed in production.
 */
export default function webhookPlugin(options: WebhookPluginOptions): AmplessPlugin {
  // Keep constructor endpoints as a closure-private fallback.
  // They are intentionally NOT exposed in the plugin manifest.
  const endpoints = options.endpoints

  // Build a hooks map covering every distinct event any endpoint cares
  // about. Endpoint-level filtering happens inside the dispatcher.
  const subscribed = new Set<EventType>()
  for (const ep of endpoints) {
    const events = ep.events ?? ALL_CONTENT_EVENTS
    events.forEach((e) => subscribed.add(e))
  }

  const hooks = {} as NonNullable<AmplessPlugin['hooks']>
  for (const eventType of subscribed) {
    hooks[eventType] = async (event, ctx) => {
      // Resolve the admin-managed signing secret. When present it takes
      // precedence over per-endpoint constructor secrets so operators can
      // rotate the key from the admin UI without redeploying.
      const adminSecret = await (ctx as TrustedPluginRuntimeContext).secret<string>('signingSecret')
      await dispatch(endpoints, event, adminSecret)
    }
  }

  return definePlugin({
    name: 'webhook',
    packageName: '@ampless/plugin-webhook',
    apiVersion: 1,
    trust_level: 'trusted',
    capabilities: ['eventHooks', 'secretSettings'],
    settings: {
      secret: [
        {
          type: 'text',
          key: 'signingSecret',
          maxLength: 256,
          label: { en: 'Signing secret', ja: '署名シークレット' },
          description: {
            en: 'HMAC-SHA-256 signing secret applied to all webhook endpoints. When set, overrides the per-endpoint constructor secret. Rotate here without redeploying.',
            ja: 'すべての Webhook エンドポイントに適用する HMAC-SHA-256 署名シークレット。設定するとコンストラクタ側の per-endpoint secret より優先されます。再デプロイ不要でここから更新してください。',
          },
        },
      ],
    },
    hooks,
  })
}


async function dispatch(
  endpoints: WebhookEndpoint[],
  event: AmplessEvent,
  adminSecret: string | undefined,
): Promise<void> {
  const body = JSON.stringify({
    type: event.type,
    payload: event.payload,
    timestamp: event.timestamp,
  })

  // Fire all matching endpoints in parallel; one failing endpoint
  // shouldn't block the others. Failures throw so SQS retries (and
  // eventually the DLQ catches them).
  const results = await Promise.allSettled(
    endpoints
      .filter((ep) => (ep.events ?? ALL_CONTENT_EVENTS).includes(event.type))
      .map((ep) => postOne(ep, body, event.type, adminSecret))
  )

  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failures.length > 0) {
    const messages = failures.map((f) => String(f.reason)).join('; ')
    throw new Error(`webhook plugin: ${failures.length} endpoint(s) failed — ${messages}`)
  }
}

async function postOne(
  endpoint: WebhookEndpoint,
  body: string,
  eventType: string,
  adminSecret: string | undefined,
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Ampless-Event': eventType,
    ...(endpoint.headers ?? {}),
  }
  // Admin-managed secret takes precedence; fall back to per-endpoint constructor secret.
  const effectiveSecret = adminSecret ?? endpoint.secret
  if (effectiveSecret) {
    headers['X-Ampless-Signature'] = signPayload(effectiveSecret, body)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), endpoint.timeoutMs ?? 5000)
  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`${endpoint.url} returned ${response.status}`)
    }
  } finally {
    clearTimeout(timer)
  }
}

export { signPayload }
