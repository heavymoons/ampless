import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  dispatchJsonRpc,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_METHOD_NOT_FOUND,
  LATEST_SUPPORTED_PROTOCOL_VERSION,
  type JsonRpcRequest,
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

    it('an unknown method with an id → METHOD_NOT_FOUND', async () => {
      const res = await dispatchJsonRpc(
        { jsonrpc: '2.0', id: 9, method: 'mystery/probe' },
        opts()
      )
      expect(res?.error?.code).toBe(JSON_RPC_METHOD_NOT_FOUND)
    })
  })
})
