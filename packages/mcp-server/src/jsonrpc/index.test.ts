import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  dispatchJsonRpc,
  dispatchJsonRpcMessage,
  MAX_BATCH,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  LATEST_SUPPORTED_PROTOCOL_VERSION,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './index.js'
import type { ToolDefinition } from '../tools/index.js'

interface FakeCtx {
  tag: string
}

const okTool: ToolDefinition<FakeCtx> = {
  name: 'echo',
  description: 'echoes',
  inputSchema: { type: 'object', properties: {} },
  readOnly: true,
  destructive: false,
  handler: async (args, ctx) => ({ args, ctxTag: ctx.tag }),
}

const writeTool: ToolDefinition<FakeCtx> = {
  name: 'destroy',
  description: 'destroys',
  inputSchema: { type: 'object', properties: {} },
  readOnly: false,
  destructive: true,
  handler: async () => ({ done: true }),
}

// Deliberately unclassified (no readOnly / destructive) to prove the
// dispatch omits destructiveHint rather than defaulting it to false.
const unclassifiedTool: ToolDefinition<FakeCtx> = {
  name: 'mystery',
  description: 'unclassified',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => ({}),
}

const throwingTool: ToolDefinition<FakeCtx> = {
  name: 'boom',
  description: 'throws',
  inputSchema: { type: 'object', properties: {} },
  readOnly: true,
  destructive: false,
  handler: async () => {
    throw new Error('kaboom detail')
  },
}

const TOOLS = [okTool, writeTool, unclassifiedTool, throwingTool]
const serverInfo = { name: 'test-mcp', version: '1.0' }

function opts(overrides: Partial<Parameters<typeof dispatchJsonRpc<FakeCtx>>[1]> = {}) {
  return {
    tools: TOOLS,
    getContext: () => ({ tag: 'ctx-1' }),
    serverInfo,
    ...overrides,
  }
}

describe('dispatchJsonRpc', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initialize protocol negotiation', () => {
    it('echoes a supported requested version', async () => {
      const res = await dispatchJsonRpc(
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
        opts()
      )
      expect(res?.result).toMatchObject({ protocolVersion: '2024-11-05', serverInfo })
    })

    it('negotiates down to the latest supported version for an unknown request', async () => {
      const res = await dispatchJsonRpc(
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 'bogus' } },
        opts()
      )
      expect((res?.result as { protocolVersion: string }).protocolVersion).toBe(
        LATEST_SUPPORTED_PROTOCOL_VERSION
      )
    })

    it('returns INVALID_PARAMS when protocolVersion is missing', async () => {
      const res = await dispatchJsonRpc(
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        opts()
      )
      expect(res?.error?.code).toBe(JSON_RPC_INVALID_PARAMS)
    })

    it.each([
      ['number', 42],
      ['null', null],
      ['object', { v: '2025-03-26' }],
    ])(
      'returns INVALID_PARAMS when protocolVersion is a %s (no latest-version fallback)',
      async (_label, badVersion) => {
        const res = await dispatchJsonRpc(
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: badVersion as never },
          },
          opts()
        )
        expect(res?.error?.code).toBe(JSON_RPC_INVALID_PARAMS)
      }
    )
  })

  describe('request id validation', () => {
    it.each([
      ['null', null],
      ['fractional number', 1.5],
    ])('id: %s → INVALID_REQUEST (not treated as a notification)', async (_label, badId) => {
      const res = await dispatchJsonRpc(
        { jsonrpc: '2.0', id: badId, method: 'tools/list' } as unknown as JsonRpcRequest,
        opts()
      )
      expect(res?.error?.code).toBe(JSON_RPC_INVALID_REQUEST)
      expect(res?.id).toBeNull()
    })

    it.each([
      ['string', 'abc'],
      ['zero', 0],
    ])('id: %s is a valid request id', async (_label, goodId) => {
      const res = await dispatchJsonRpc(
        { jsonrpc: '2.0', id: goodId, method: 'tools/list' },
        opts()
      )
      expect(res?.error).toBeUndefined()
      expect(res?.id).toBe(goodId)
      expect(res?.result).toBeDefined()
    })
  })

  describe('tools/list annotations', () => {
    it('emits readOnlyHint/destructiveHint for classified tools and omits destructiveHint for unclassified', async () => {
      const res = await dispatchJsonRpc(
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        opts()
      )
      const tools = (res?.result as { tools: { name: string; annotations: Record<string, boolean> }[] }).tools
      const byName = new Map(tools.map((t) => [t.name, t.annotations]))
      expect(byName.get('echo')).toEqual({ readOnlyHint: true, destructiveHint: false })
      expect(byName.get('destroy')).toEqual({ readOnlyHint: false, destructiveHint: true })
      // Unclassified: no destructiveHint (spec default true applies).
      expect(byName.get('mystery')).toEqual({})
    })
  })

  describe('tools/call', () => {
    it('invokes the handler with the arguments + lazily-resolved context', async () => {
      const getContext = vi.fn(() => ({ tag: 'lazy' }))
      const res = await dispatchJsonRpc(
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'echo', arguments: { hello: 'world' } },
        },
        opts({ getContext })
      )
      const payload = JSON.parse((res?.result as { content: { text: string }[] }).content[0]!.text)
      expect(payload).toEqual({ args: { hello: 'world' }, ctxTag: 'lazy' })
      expect(getContext).toHaveBeenCalledOnce()
    })

    it('does not resolve context for initialize / tools/list', async () => {
      const getContext = vi.fn(() => ({ tag: 'x' }))
      await dispatchJsonRpc(
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
        opts({ getContext })
      )
      await dispatchJsonRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, opts({ getContext }))
      expect(getContext).not.toHaveBeenCalled()
    })

    it('unknown tool → METHOD_NOT_FOUND', async () => {
      const res = await dispatchJsonRpc(
        { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } },
        opts()
      )
      expect(res?.error?.code).toBe(JSON_RPC_METHOD_NOT_FOUND)
    })

    it('missing name → INVALID_PARAMS', async () => {
      const res = await dispatchJsonRpc(
        { jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} },
        opts()
      )
      expect(res?.error?.code).toBe(JSON_RPC_INVALID_PARAMS)
    })

    it.each([
      ['array', [1, 2, 3]],
      ['string', 'not-an-object'],
      ['null', null],
    ])('arguments that are %s → INVALID_PARAMS', async (_label, badArgs) => {
      const res = await dispatchJsonRpc(
        {
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: { name: 'echo', arguments: badArgs },
        },
        opts()
      )
      expect(res?.error?.code).toBe(JSON_RPC_INVALID_PARAMS)
    })

    it('tool exception → isError content with the raw message (no formatToolError)', async () => {
      const res = await dispatchJsonRpc(
        { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'boom' } },
        opts()
      )
      const result = res?.result as { isError: boolean; content: { text: string }[] }
      expect(result.isError).toBe(true)
      expect(result.content[0]!.text).toBe('kaboom detail')
    })

    it('tool exception → formatToolError masks the client message but logs the detail', async () => {
      const res = await dispatchJsonRpc(
        { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'boom' } },
        opts({ formatToolError: () => 'Internal error while executing the tool.' })
      )
      const result = res?.result as { isError: boolean; content: { text: string }[] }
      expect(result.isError).toBe(true)
      expect(result.content[0]!.text).toBe('Internal error while executing the tool.')
      // The raw detail is still logged server-side.
      expect(console.error).toHaveBeenCalledWith(
        '[mcp-jsonrpc] tool dispatch failed',
        expect.objectContaining({ tool: 'boom', message: 'kaboom detail' })
      )
    })
  })

  describe('notifications & unknown methods', () => {
    it('notifications/initialized (id absent) returns null (no response)', async () => {
      const res = await dispatchJsonRpc(
        { jsonrpc: '2.0', method: 'notifications/initialized' } as JsonRpcRequest,
        opts()
      )
      expect(res).toBeNull()
    })

    it('an unknown notification (id absent) returns null', async () => {
      const res = await dispatchJsonRpc(
        { jsonrpc: '2.0', method: 'some/other/notification' } as JsonRpcRequest,
        opts()
      )
      expect(res).toBeNull()
    })

    it('a tools/list notification (id absent) returns null', async () => {
      const res = await dispatchJsonRpc(
        { jsonrpc: '2.0', method: 'tools/list' } as JsonRpcRequest,
        opts()
      )
      expect(res).toBeNull()
    })

    it('a tools/call notification (id absent) returns null but still executes the tool handler', async () => {
      const spyHandler = vi.fn(async () => ({ ran: true }))
      const spiedTool: ToolDefinition<FakeCtx> = {
        name: 'spy',
        description: 'spies',
        inputSchema: { type: 'object', properties: {} },
        readOnly: false,
        destructive: false,
        handler: spyHandler,
      }
      const res = await dispatchJsonRpc(
        {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'spy', arguments: { via: 'notification' } },
        } as JsonRpcRequest,
        opts({ tools: [spiedTool] })
      )
      expect(res).toBeNull()
      expect(spyHandler).toHaveBeenCalledOnce()
      expect(spyHandler).toHaveBeenCalledWith({ via: 'notification' }, { tag: 'ctx-1' })
    })

    it('an unknown method with an id → METHOD_NOT_FOUND', async () => {
      const res = await dispatchJsonRpc(
        { jsonrpc: '2.0', id: 9, method: 'mystery/probe' },
        opts()
      )
      expect(res?.error?.code).toBe(JSON_RPC_METHOD_NOT_FOUND)
    })
  })
})

describe('dispatchJsonRpcMessage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // --- single object ---

  describe('single object', () => {
    it('a valid request → { status: ok, body: <single response> }', async () => {
      const res = await dispatchJsonRpcMessage(
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        opts()
      )
      expect(res.status).toBe('ok')
      const body = (res as { body: JsonRpcResponse }).body
      expect(Array.isArray(body)).toBe(false)
      expect(body.id).toBe(1)
      expect(body.result).toBeDefined()
    })

    it('a notification → { status: no-content }', async () => {
      const res = await dispatchJsonRpcMessage(
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        opts()
      )
      expect(res.status).toBe('no-content')
    })

    it.each([
      ['null', null],
      ['scalar number', 42],
      ['scalar string', 'hi'],
    ])('a non-object %s → { status: invalid } INVALID_REQUEST (id:null)', async (_label, input) => {
      const res = await dispatchJsonRpcMessage(input, opts())
      expect(res.status).toBe('invalid')
      const body = (res as { body: JsonRpcResponse }).body
      expect(body.error?.code).toBe(JSON_RPC_INVALID_REQUEST)
      expect(body.id).toBeNull()
    })

    it('an object with a bad envelope (jsonrpc !== 2.0) → { status: invalid }', async () => {
      const res = await dispatchJsonRpcMessage(
        { jsonrpc: '1.0', id: 1, method: 'tools/list' },
        opts()
      )
      expect(res.status).toBe('invalid')
      expect((res as { body: JsonRpcResponse }).body.error?.code).toBe(JSON_RPC_INVALID_REQUEST)
    })

    it('an object with id:null → { status: invalid } (MCP forbids null ids)', async () => {
      const res = await dispatchJsonRpcMessage(
        { jsonrpc: '2.0', id: null, method: 'tools/list' },
        opts()
      )
      expect(res.status).toBe('invalid')
      expect((res as { body: JsonRpcResponse }).body.id).toBeNull()
    })

    it('a single object may contain initialize (only batch elements forbid it)', async () => {
      const res = await dispatchJsonRpcMessage(
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
        opts()
      )
      expect(res.status).toBe('ok')
      expect((res as { body: JsonRpcResponse }).body.result).toMatchObject({
        protocolVersion: '2024-11-05',
      })
    })
  })

  // --- batch ---

  describe('batch', () => {
    it('empty array → { status: invalid } (top-level)', async () => {
      const res = await dispatchJsonRpcMessage([], opts())
      expect(res.status).toBe('invalid')
      expect((res as { body: JsonRpcResponse }).body.error?.code).toBe(JSON_RPC_INVALID_REQUEST)
    })

    it('array longer than maxBatch → { status: invalid } (top-level)', async () => {
      const batch = Array.from({ length: 3 }, (_v, i) => ({
        jsonrpc: '2.0' as const,
        id: i,
        method: 'tools/list',
      }))
      const res = await dispatchJsonRpcMessage(batch, { ...opts(), maxBatch: 2 })
      expect(res.status).toBe('invalid')
    })

    it('mixed valid request + notification → only the request response, order preserved, 200', async () => {
      const res = await dispatchJsonRpcMessage(
        [
          { jsonrpc: '2.0', id: 'a', method: 'tools/list' },
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { jsonrpc: '2.0', id: 'b', method: 'tools/list' },
        ],
        opts()
      )
      expect(res.status).toBe('ok')
      const body = (res as { body: JsonRpcResponse[] }).body
      expect(Array.isArray(body)).toBe(true)
      expect(body.map((r) => r.id)).toEqual(['a', 'b'])
    })

    it('all-notification batch → { status: no-content }', async () => {
      const res = await dispatchJsonRpcMessage(
        [
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { jsonrpc: '2.0', method: 'some/other/notification' },
        ],
        opts()
      )
      expect(res.status).toBe('no-content')
    })

    it('malformed elements mixed in: bad elements become id:null errors, notification excluded, order kept', async () => {
      const res = await dispatchJsonRpcMessage(
        [
          { jsonrpc: '2.0', id: 1, method: 'tools/list' }, // valid request
          { jsonrpc: '2.0', method: 'notifications/initialized' }, // notification (excluded)
          null, // non-object
          { jsonrpc: '2.0', id: 3 }, // method missing
        ],
        opts()
      )
      expect(res.status).toBe('ok')
      const body = (res as { body: JsonRpcResponse[] }).body
      // Three entries: the valid request response + two errors; the
      // notification produced no response.
      expect(body.length).toBe(3)
      // Order preserved: request result first.
      expect(body[0]!.id).toBe(1)
      expect(body[0]!.result).toBeDefined()
      // null element → INVALID_REQUEST with id:null.
      expect(body[1]!.id).toBeNull()
      expect(body[1]!.error?.code).toBe(JSON_RPC_INVALID_REQUEST)
      // method-missing element (id:3 present + valid) → error echoes id.
      expect(body[2]!.id).toBe(3)
      expect(body[2]!.error?.code).toBe(JSON_RPC_INVALID_REQUEST)
    })

    it('an initialize element inside a batch → that element is INVALID_REQUEST', async () => {
      const res = await dispatchJsonRpcMessage(
        [
          { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
          { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        ],
        opts()
      )
      expect(res.status).toBe('ok')
      const body = (res as { body: JsonRpcResponse[] }).body
      expect(body[0]!.id).toBe(1)
      expect(body[0]!.error?.code).toBe(JSON_RPC_INVALID_REQUEST)
      // The sibling tools/list still succeeds.
      expect(body[1]!.id).toBe(2)
      expect(body[1]!.result).toBeDefined()
    })

    it('processes batch elements sequentially (never Promise.all)', async () => {
      const order: string[] = []
      let active = 0
      let maxActive = 0
      const serialTool: ToolDefinition<FakeCtx> = {
        name: 'serial',
        description: 'records concurrency',
        inputSchema: { type: 'object', properties: {} },
        handler: async (args) => {
          active++
          maxActive = Math.max(maxActive, active)
          order.push((args as { tag: string }).tag)
          await new Promise((r) => setTimeout(r, 5))
          active--
          return {}
        },
      }
      await dispatchJsonRpcMessage(
        [
          { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'serial', arguments: { tag: 'first' } } },
          { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'serial', arguments: { tag: 'second' } } },
        ],
        opts({ tools: [serialTool] })
      )
      expect(order).toEqual(['first', 'second'])
      // Never two handlers in flight simultaneously.
      expect(maxActive).toBe(1)
    })

    it('MAX_BATCH default is 50', () => {
      expect(MAX_BATCH).toBe(50)
    })
  })
})
