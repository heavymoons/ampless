// Shared JSON-RPC 2.0 dispatch for MCP transports.
//
// Previously this logic lived inline in the backend `mcp-handler`
// Lambda. It is lifted here (parameterised over the tool registry and
// its context type) so both the admin HTTP transport (backend) and the
// public read-only transport (runtime, PR-8) run the exact same wire
// behaviour — `initialize` / `notifications/initialized` / `tools/list`
// / `tools/call` — over different tool registries.
//
// This module owns the JSON-RPC envelope and MCP method semantics only.
// HTTP framing (base64 body decode, status codes, CORS/OPTIONS, auth)
// stays in each transport's handler.

import type { ToolDefinition } from '../tools/index.js'

// Standard JSON-RPC 2.0 error codes
// https://www.jsonrpc.org/specification#error_object
export const JSON_RPC_PARSE_ERROR = -32700
export const JSON_RPC_INVALID_REQUEST = -32600
export const JSON_RPC_METHOD_NOT_FOUND = -32601
export const JSON_RPC_INVALID_PARAMS = -32602
export const JSON_RPC_INTERNAL_ERROR = -32603

// Protocol versions we can negotiate on `initialize`, newest first.
//
// `2025-03-26` is the first spec revision to define tool annotations
// (`readOnlyHint` / `destructiveHint`), which `tools/list` emits below.
// `2024-11-05` is retained for older clients; annotations are a
// forward-compatible JSON field they simply ignore.
//
// We deliberately do NOT advertise `2025-06-18`: that revision adds
// transport-level obligations (e.g. echoing the negotiated
// `MCP-Protocol-Version` on subsequent HTTP requests) that these
// stateless JSON-POST transports don't implement. Annotations do not
// require it.
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-03-26', '2024-11-05'] as const
// Version we fall back to when the client requests an unsupported one.
export const LATEST_SUPPORTED_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  /**
   * Absent (`undefined`) marks a JSON-RPC *notification*: per spec the
   * server must not send any response (the method still executes). MCP
   * forbids `id: null`, and JSON-RPC numeric ids SHOULD NOT contain
   * fractional parts — `hasValidJsonRpcId` rejects both as
   * INVALID_REQUEST before dispatch.
   */
  id?: number | string
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export function jsonRpcResult(id: JsonRpcResponse['id'], result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

export function jsonRpcError(
  id: JsonRpcResponse['id'],
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  const error: JsonRpcResponse['error'] = { code, message }
  if (data !== undefined) error.data = data
  return { jsonrpc: '2.0', id, error }
}

export interface JsonRpcDispatchOptions<TCtx> {
  tools: readonly ToolDefinition<TCtx>[]
  /**
   * Resolves the tool context. Called lazily — only on a valid
   * `tools/call` for a known tool — so `initialize` / `tools/list`
   * never pay for client construction.
   */
  getContext: () => TCtx
  serverInfo: { name: string; version: string }
  /**
   * Converts a tool handler exception into the string surfaced to the
   * client. Omit to expose the raw error message (admin transport).
   * The public transport passes a fixed message here and logs the
   * detail server-side instead.
   */
  formatToolError?: (err: unknown) => string
}

/** A JSON-RPC notification (id absent) gets no response. */
function isNotification(req: JsonRpcRequest): boolean {
  return req.id === undefined
}

/**
 * Validates the `id` member of a decoded request envelope. A valid id
 * is a string or an integer number; an *absent* id is also valid (it
 * marks a notification — JSON cannot express `undefined`, so a
 * present-but-undefined id from an in-process caller is treated the
 * same). MCP explicitly forbids `id: null`, and the JSON-RPC 2.0 spec
 * says numeric ids SHOULD NOT contain fractional parts — both are
 * rejected (callers map `false` to INVALID_REQUEST). Exported so each
 * transport's pre-dispatch envelope check enforces the same rule as
 * `dispatchJsonRpc` itself.
 */
export function hasValidJsonRpcId(req: object): boolean {
  const id = (req as { id?: unknown }).id
  if (id === undefined) return true
  return typeof id === 'string' || (typeof id === 'number' && Number.isInteger(id))
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Maximum number of elements a single JSON-RPC batch may carry. A batch
// larger than this is rejected wholesale as INVALID_REQUEST — an
// unbounded batch would let one HTTP request fan out into arbitrarily
// many tool executions. Callers can override via `opts.maxBatch`.
export const MAX_BATCH = 50

/**
 * Result of dispatching an *unvalidated* decoded JSON-RPC message
 * (single object or batch array) through `dispatchJsonRpcMessage`. The
 * `status` tag tells the HTTP transport which response to emit:
 *
 *   - `invalid`    → 400 (top-level malformed: non-object scalar, empty
 *                    batch, or over-size batch). `body` is the single
 *                    error envelope to return.
 *   - `ok`         → 200. `body` is a single response, or a batch's
 *                    array of responses (invalid *elements* of a batch
 *                    are error responses *inside* this array, still 200).
 *   - `no-content` → 202 empty body (a lone notification, or a batch
 *                    made entirely of notifications).
 */
export type JsonRpcMessageResult =
  | { status: 'invalid'; body: JsonRpcResponse }
  | { status: 'ok'; body: JsonRpcResponse | JsonRpcResponse[] }
  | { status: 'no-content' }

export interface JsonRpcDispatchMessageOptions<TCtx> extends JsonRpcDispatchOptions<TCtx> {
  /** Batch element cap. Defaults to `MAX_BATCH` (50). */
  maxBatch?: number
}

// Best-effort id for an error response: echo the request's id only when
// it is a valid JSON-RPC id, else `null` (per spec, a response to a
// request with an unusable/absent id carries `id: null`).
function idForError(input: unknown): JsonRpcResponse['id'] {
  if (isPlainObject(input) && hasValidJsonRpcId(input)) {
    return (input as { id?: JsonRpcRequest['id'] }).id ?? null
  }
  return null
}

/**
 * Validate one decoded envelope. Returns the typed request when the
 * envelope passes, or an INVALID_REQUEST error response when it fails.
 * `inBatch` additionally rejects `initialize` — MCP forbids putting an
 * `initialize` request inside a batch.
 */
function validateEnvelope(
  input: unknown,
  inBatch: boolean,
): { ok: true; req: JsonRpcRequest } | { ok: false; error: JsonRpcResponse } {
  if (!isPlainObject(input)) {
    return { ok: false, error: jsonRpcError(null, JSON_RPC_INVALID_REQUEST, 'Invalid Request') }
  }
  const jsonrpc = (input as { jsonrpc?: unknown }).jsonrpc
  const method = (input as { method?: unknown }).method
  if (jsonrpc !== '2.0' || typeof method !== 'string' || !hasValidJsonRpcId(input)) {
    return {
      ok: false,
      error: jsonRpcError(idForError(input), JSON_RPC_INVALID_REQUEST, 'Invalid Request'),
    }
  }
  if (inBatch && method === 'initialize') {
    return {
      ok: false,
      error: jsonRpcError(
        idForError(input),
        JSON_RPC_INVALID_REQUEST,
        'Invalid Request: `initialize` is not allowed in a batch',
      ),
    }
  }
  return { ok: true, req: input as unknown as JsonRpcRequest }
}

/**
 * Dispatch an *unvalidated* decoded JSON-RPC message — the single entry
 * point every transport should use once it has `JSON.parse`d the body.
 * Envelope validation, batch handling, and MCP method semantics are all
 * centralised here so the admin (backend Lambda) and public (runtime)
 * transports share one implementation; the transport keeps only HTTP
 * framing (body decode, status codes, CORS, auth).
 *
 * Batch semantics (JSON-RPC 2.0):
 *   - An array is a batch. Empty / over-`maxBatch` batches are rejected
 *     wholesale as a single top-level INVALID_REQUEST (`status: 'invalid'`).
 *   - Elements are processed **sequentially** (never `Promise.all`) so a
 *     batch of tool calls cannot fan out into concurrent handler runs.
 *   - Malformed elements yield an INVALID_REQUEST response inside the
 *     result array (id echoed when valid, else null); `initialize` is
 *     not allowed as a batch element. Notifications execute but emit no
 *     response. Non-notification responses keep the input order.
 *   - A batch that yields no responses at all (all notifications) →
 *     `no-content`.
 */
export async function dispatchJsonRpcMessage<TCtx>(
  input: unknown,
  opts: JsonRpcDispatchMessageOptions<TCtx>,
): Promise<JsonRpcMessageResult> {
  const maxBatch = opts.maxBatch ?? MAX_BATCH

  if (Array.isArray(input)) {
    if (input.length === 0 || input.length > maxBatch) {
      return {
        status: 'invalid',
        body: jsonRpcError(
          null,
          JSON_RPC_INVALID_REQUEST,
          input.length === 0
            ? 'Invalid Request: empty batch'
            : `Invalid Request: batch exceeds the maximum of ${maxBatch} elements`,
        ),
      }
    }
    const responses: JsonRpcResponse[] = []
    for (const element of input) {
      const validated = validateEnvelope(element, true)
      if (!validated.ok) {
        responses.push(validated.error)
        continue
      }
      const res = await dispatchJsonRpc(validated.req, opts)
      if (res !== null) responses.push(res)
    }
    return responses.length === 0 ? { status: 'no-content' } : { status: 'ok', body: responses }
  }

  const validated = validateEnvelope(input, false)
  if (!validated.ok) {
    return { status: 'invalid', body: validated.error }
  }
  const res = await dispatchJsonRpc(validated.req, opts)
  return res === null ? { status: 'no-content' } : { status: 'ok', body: res }
}

// Build the MCP tool annotations. Only emit a hint when the tool has
// been explicitly classified — an unclassified `destructive`
// (undefined) omits `destructiveHint`, letting the spec default (true,
// the safe side) apply. The annotations object is always present; a
// pre-2025-03-26 client harmlessly ignores the unknown field.
function toolAnnotations(t: {
  readOnly?: boolean
  destructive?: boolean
}): Record<string, boolean> {
  const annotations: Record<string, boolean> = {}
  if (typeof t.readOnly === 'boolean') annotations.readOnlyHint = t.readOnly
  if (typeof t.destructive === 'boolean') annotations.destructiveHint = t.destructive
  return annotations
}

/**
 * Dispatch one parsed JSON-RPC request against a tool registry.
 * Returns the response envelope, or `null` for a notification (the
 * caller maps that to an empty 202/no-body HTTP response).
 *
 * Notification suppression is centralised here: a notification (id
 * absent) still *executes* its method — including a `tools/call`
 * handler and its side effects — but the response envelope is
 * discarded, per the JSON-RPC 2.0 spec.
 */
export async function dispatchJsonRpc<TCtx>(
  req: JsonRpcRequest,
  opts: JsonRpcDispatchOptions<TCtx>,
): Promise<JsonRpcResponse | null> {
  // MCP forbids `id: null`, and JSON-RPC numeric ids SHOULD NOT contain
  // fractional parts. A malformed id is INVALID_REQUEST — distinct from
  // an *absent* id, which marks a notification.
  if (!hasValidJsonRpcId(req)) {
    return jsonRpcError(
      null,
      JSON_RPC_INVALID_REQUEST,
      'Invalid Request: `id` must be a string or an integer',
    )
  }
  const response = await dispatchMethod(req, opts)
  return isNotification(req) ? null : response
}

/** The per-method dispatch; always builds a response envelope. */
async function dispatchMethod<TCtx>(
  req: JsonRpcRequest,
  opts: JsonRpcDispatchOptions<TCtx>,
): Promise<JsonRpcResponse> {
  const id = req.id ?? null

  switch (req.method) {
    case 'initialize': {
      const requested = (req.params as { protocolVersion?: unknown } | undefined)?.protocolVersion
      // `protocolVersion` is a required string `initialize` parameter —
      // a missing or non-string one (number / null / object) is a
      // malformed request, not a version we silently default. Only an
      // *unsupported string* falls back to the latest supported version.
      if (typeof requested !== 'string') {
        return jsonRpcError(
          id,
          JSON_RPC_INVALID_PARAMS,
          'initialize requires a string `protocolVersion` parameter',
        )
      }
      const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(
        requested,
      )
        ? requested
        : LATEST_SUPPORTED_PROTOCOL_VERSION
      return jsonRpcResult(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: opts.serverInfo,
      })
    }

    case 'notifications/initialized':
      // One-way notification: MCP clients fire this after `initialize`
      // with no id, so the wrapper suppresses this envelope. If a client
      // (incorrectly) attaches an id, acknowledge with an empty result
      // rather than violating "every request gets a response".
      return jsonRpcResult(id, {})

    case 'tools/list':
      return jsonRpcResult(id, {
        tools: opts.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: toolAnnotations(t),
        })),
      })

    case 'tools/call': {
      const params = req.params as { name?: unknown; arguments?: unknown } | undefined
      if (!params || typeof params.name !== 'string') {
        return jsonRpcError(id, JSON_RPC_INVALID_PARAMS, 'tools/call requires a `name` parameter')
      }
      const rawArgs = params.arguments
      if (rawArgs !== undefined && !isPlainObject(rawArgs)) {
        return jsonRpcError(
          id,
          JSON_RPC_INVALID_PARAMS,
          'tools/call `arguments` must be an object',
        )
      }
      const tool = opts.tools.find((t) => t.name === params.name)
      if (!tool) {
        return jsonRpcError(id, JSON_RPC_METHOD_NOT_FOUND, `unknown tool: ${params.name}`)
      }
      const ctx = opts.getContext()
      try {
        const result = await tool.handler(rawArgs ?? {}, ctx)
        // MCP tools/call success shape: { content: [{ type, text }] }.
        return jsonRpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        })
      } catch (err) {
        // Tool errors are reported via isError + content (per MCP), not
        // as JSON-RPC protocol errors. Always log the raw detail so the
        // public transport (which masks the client-facing message via
        // formatToolError) still leaves a trail in CloudWatch.
        const rawMessage = err instanceof Error ? err.message : String(err)
        console.error('[mcp-jsonrpc] tool dispatch failed', {
          tool: params.name,
          message: rawMessage,
        })
        const message = opts.formatToolError ? opts.formatToolError(err) : rawMessage
        return jsonRpcResult(id, {
          isError: true,
          content: [{ type: 'text', text: message }],
        })
      }
    }

    default:
      // Unknown method → method-not-found. For an unknown *notification*
      // the wrapper discards this envelope (spec: no response).
      return jsonRpcError(id, JSON_RPC_METHOD_NOT_FOUND, `Method not found: ${req.method}`)
  }
}
