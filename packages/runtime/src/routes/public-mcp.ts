// Anonymous, read-only public MCP endpoint mounted at `app/api/mcp/route.ts`.
//
// JSON-RPC 2.0 over POST. Serves the four `@ampless/mcp-server/public`
// tools (published posts only, field-allowlisted) through the same
// shared `dispatchJsonRpcMessage` the admin transport uses — this file
// owns only the HTTP framing: the `ai.publicMcp` gate, CORS, a byte-
// capped body reader, a coarse circuit breaker, and the tagged-result →
// HTTP status mapping.
//
// Opt-in: `cms.config.ai.publicMcp` must be explicitly `true`, else every
// method (POST and OPTIONS) 404s. The endpoint is unauthenticated, so the
// default is off.
//
// Runtime note: the template route sets `export const runtime = 'nodejs'`
// — the circuit breaker below is module-scope state that only persists on
// a warm Node lambda, never on Edge.

import {
  dispatchJsonRpcMessage,
  jsonRpcError,
  JSON_RPC_PARSE_ERROR,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_INTERNAL_ERROR,
  MAX_BATCH,
} from '@ampless/mcp-server/jsonrpc'
import { publicTools, type PublicToolContext } from '@ampless/mcp-server/public'
import type { Ampless } from '../index.js'

export interface PublicMcpRouteHandlers {
  POST: (request: Request) => Promise<Response>
  OPTIONS: (request: Request) => Promise<Response>
}

// Hard body cap. Content-Length over this is a 413 before we read a byte;
// a stream that exceeds it is aborted mid-read (we never buffer the whole
// request via `request.text()`).
const MAX_BODY_BYTES = 64 * 1024

// --- Circuit breaker (warm-instance scope, NOT per-IP) -------------------
//
// This is deliberately NOT a per-user / per-IP rate limiter. CloudFront
// preserves a client-supplied `x-forwarded-for` and only *appends* the
// real edge IP, so the leftmost value is spoofable and the proxy hop
// count isn't guaranteed — we can't derive a trustworthy client IP here.
// Instead this is a coarse, fail-closed circuit breaker: a single
// module-scope fixed-window counter that stops one warm instance from
// being pinned by a runaway caller. All anonymous callers on an instance
// share the same 600/min budget, so the ceiling is set high to avoid
// throttling legitimate concurrent readers. It only bites within one warm
// instance; cold starts and parallel lambdas each get a fresh budget.
// Real per-IP throttling / DoS protection is CloudFront / WAF's job. The
// data-exposure surface is already bounded structurally (published-only,
// read-only, per-request page/item caps in the public tools).
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 600

let rateState = { count: 0, windowExpires: 0 }

/**
 * Reserve `n` units in the current fixed window. Returns `true` when the
 * reservation fits under `RATE_MAX`, `false` when it would exceed it (the
 * caller answers 429). A batch reserves one unit per element so a large
 * batch can't sneak past a single-unit charge.
 */
function reserve(n: number): boolean {
  const now = Date.now()
  if (now >= rateState.windowExpires) {
    rateState = { count: 0, windowExpires: now + RATE_WINDOW_MS }
  }
  if (rateState.count + n > RATE_MAX) return false
  rateState.count += n
  return true
}

function retryAfterSeconds(): number {
  return Math.max(1, Math.ceil((rateState.windowExpires - Date.now()) / 1000))
}

/**
 * Test hook: reset the module-scope circuit breaker between cases.
 * Production code never calls this — the counter is intentionally
 * process-local (mirrors middleware's `_resetFlagCache`).
 */
export function _resetPublicMcpRateLimit(): void {
  rateState = { count: 0, windowExpires: 0 }
}

// --- CORS ---------------------------------------------------------------
//
// Open CORS is safe here: anonymous, read-only, published-only, and no
// credentials are used (same posture as the admin MCP transport).

function corsHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, mcp-protocol-version',
    'Access-Control-Max-Age': '86400',
    ...extra,
  }
}

// --- Response helpers (every response carries CORS) ----------------------

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }),
  })
}

function notFound(): Response {
  return new Response('Not Found', { status: 404, headers: corsHeaders() })
}

function rateLimited(): Response {
  // No standard JSON-RPC code for rate limiting → implementation-defined
  // -32000 (the reserved server-error range).
  return new Response(JSON.stringify(jsonRpcError(null, -32000, 'Rate limit exceeded')), {
    status: 429,
    headers: corsHeaders({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Retry-After': String(retryAfterSeconds()),
    }),
  })
}

function payloadTooLarge(): Response {
  return new Response(
    JSON.stringify(jsonRpcError(null, JSON_RPC_INVALID_REQUEST, 'Payload too large')),
    {
      status: 413,
      headers: corsHeaders({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }),
    },
  )
}

// --- Byte-capped body reader --------------------------------------------

/**
 * Read the request body as UTF-8, aborting at `MAX_BODY_BYTES`. Returns
 * the decoded string, or `null` when the stream exceeds the cap (caller
 * → 413). We read the raw `ReadableStream` in byte chunks rather than
 * `request.text()` so an oversized body is stopped early instead of being
 * fully buffered. A read error propagates to the caller's outer try/catch.
 */
async function readBodyCapped(request: Request): Promise<string | null> {
  const body = request.body
  // No stream = no body (e.g. a POST with no payload) → treat as empty.
  if (!body) return ''

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > MAX_BODY_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  if (total === 0) return ''
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  // Decode only after the whole (within-cap) byte sequence is buffered, so
  // a multibyte character split across chunks decodes intact. An oversize
  // body is already a 413 above, so we never decode a truncated sequence.
  return new TextDecoder('utf-8').decode(merged)
}

/**
 * Build `{ POST, OPTIONS }` for the public MCP route. The template must
 * destructure both — a single `export const POST = ...(ampless)` assignment
 * would drop OPTIONS and break the CORS preflight.
 */
export function createPublicMcpRouteHandler(ampless: Ampless): PublicMcpRouteHandlers {
  // Explicit pick of the three methods the public tools need — the
  // `Ampless` signatures already match `PublicToolContext` exactly.
  const publicCtx: PublicToolContext = {
    listPublishedPosts: (opts) => ampless.listPublishedPosts(opts),
    getPublishedPost: (slug) => ampless.getPublishedPost(slug),
    postToMarkdown: (post, opts) => ampless.postToMarkdown(post, opts),
  }

  // Anonymous endpoint: mask the client-facing message and keep the raw
  // detail server-side only.
  function formatToolError(err: unknown): string {
    console.error('[ampless] public MCP tool error', err)
    return 'Internal error while executing the tool.'
  }

  function gateOpen(): boolean {
    return ampless.cmsConfig.ai?.publicMcp === true
  }

  async function POST(request: Request): Promise<Response> {
    // Outermost guard: a stream read failure or an unexpected dispatcher
    // exception must still return a CORS'd JSON-RPC 500, never Next.js's
    // default HTML 500.
    try {
      // 1. gate — opt-in only.
      if (!gateOpen()) return notFound()

      // 2. circuit breaker, first unit. Batch elements are charged after
      //    parse (step 5) since the count isn't known until then.
      if (!reserve(1)) return rateLimited()

      // 3. body read + size cap. Content-Length lets us 413 before reading;
      //    the stream reader 413s a chunked body that lacks/lies about it.
      const contentLength = request.headers.get('content-length')
      if (contentLength) {
        const declared = Number(contentLength)
        if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
          return payloadTooLarge()
        }
      }
      const bodyText = await readBodyCapped(request)
      if (bodyText === null) return payloadTooLarge()

      // 4. parse. Envelope / array validation is the message dispatcher's
      //    job — keep only the two framing failures here.
      if (bodyText.length === 0) {
        return jsonResponse(400, jsonRpcError(null, JSON_RPC_INVALID_REQUEST, 'Empty body'))
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(bodyText) as unknown
      } catch {
        return jsonResponse(400, jsonRpcError(null, JSON_RPC_PARSE_ERROR, 'Parse error'))
      }

      // 5. batch additional charge — only for a well-sized batch. An empty
      //    or over-`MAX_BATCH` array is left to fail as INVALID_REQUEST in
      //    step 6 without extra charge (a `reserve(-1)` on an empty batch
      //    would wrongly credit the window).
      if (Array.isArray(parsed) && parsed.length >= 1 && parsed.length <= MAX_BATCH) {
        if (!reserve(parsed.length - 1)) return rateLimited()
      }

      // 6. dispatch through the shared message layer.
      const result = await dispatchJsonRpcMessage(parsed, {
        tools: publicTools,
        getContext: () => publicCtx,
        serverInfo: { name: 'ampless-mcp', version: '0.2' },
        formatToolError,
        maxBatch: MAX_BATCH,
      })

      // 8. tagged-result → HTTP mapping.
      if (result.status === 'invalid') {
        return jsonResponse(400, result.body)
      }
      if (result.status === 'no-content') {
        return new Response(null, {
          status: 202,
          headers: corsHeaders({ 'Cache-Control': 'no-store' }),
        })
      }
      return jsonResponse(200, result.body)
    } catch (err) {
      // 9. outermost catch.
      console.error('[ampless] public MCP route error', err)
      return jsonResponse(500, jsonRpcError(null, JSON_RPC_INTERNAL_ERROR, 'Internal error'))
    }
  }

  async function OPTIONS(_request: Request): Promise<Response> {
    if (!gateOpen()) return notFound()
    return new Response(null, { status: 204, headers: corsHeaders() })
  }

  return { POST, OPTIONS }
}
