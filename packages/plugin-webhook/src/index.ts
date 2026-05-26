import { definePlugin, type AmplessEvent, type AmplessPlugin, type EventType } from 'ampless'
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
 * whenever a subscribed event fires. Runs in the untrusted Lambda — it
 * needs no AWS data access, only outbound HTTPS.
 */
export default function webhookPlugin(options: WebhookPluginOptions): AmplessPlugin {
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
    hooks[eventType] = async (event) => {
      await dispatch(endpoints, event)
    }
  }

  return definePlugin({
    name: 'webhook',
    apiVersion: 1,
    trust_level: 'untrusted',
    hooks,
  })
}


async function dispatch(endpoints: WebhookEndpoint[], event: AmplessEvent): Promise<void> {
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
      .map((ep) => postOne(ep, body, event.type))
  )

  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failures.length > 0) {
    const messages = failures.map((f) => String(f.reason)).join('; ')
    throw new Error(`webhook plugin: ${failures.length} endpoint(s) failed — ${messages}`)
  }
}

async function postOne(endpoint: WebhookEndpoint, body: string, eventType: string): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Ampless-Event': eventType,
    ...(endpoint.headers ?? {}),
  }
  if (endpoint.secret) {
    headers['X-Ampless-Signature'] = signPayload(endpoint.secret, body)
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
