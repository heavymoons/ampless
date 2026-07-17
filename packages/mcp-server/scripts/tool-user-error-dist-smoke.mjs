// Dist-level smoke test for the ToolUserError brand contract.
//
// The unit tests exercise the same behaviour against `src/`, but the
// brand exists specifically so that *independently bundled* copies of
// the class still recognise each other (tsup gives each entry point its
// own chunk graph). This script drives the actual `dist/` output:
//
//   1. A real dist ToolUserError (thrown by `get_post` for a missing
//      slug) passes its message through the public-transport masking.
//   2. A "foreign" ToolUserError — an independent constructor defined
//      right here, sharing nothing with dist but the
//      `Symbol.for('ampless.mcp.toolUserError')` brand — also passes
//      through. This is the cross-bundle guarantee the brand exists for.
//   3. An error merely *named* 'ToolUserError' but without the brand is
//      masked by `formatToolError` — the name alone must not bypass
//      masking.

import assert from 'node:assert/strict'

import { dispatchJsonRpc } from '../dist/jsonrpc/index.js'
import { publicTools } from '../dist/public/index.js'

const MASKED = 'Internal error while executing the tool.'

async function callTool(name, args, tools, getContext) {
  return dispatchJsonRpc(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    },
    {
      tools,
      getContext,
      serverInfo: { name: 'dist-smoke', version: '0' },
      formatToolError: () => MASKED,
    },
  )
}

// Case 1: dist's own ToolUserError (thrown inside get_post) survives masking.
{
  const response = await callTool('get_post', { slug: 'missing' }, publicTools, () => ({
    listPublishedPosts: async () => ({ items: [], nextToken: null }),
    getPublishedPost: async () => null,
    postToMarkdown: async () => '',
  }))
  assert.equal(response.result.isError, true)
  assert.equal(
    response.result.content[0].text,
    'No published post found for the requested slug.',
  )
}

// Case 2: a foreign ToolUserError — a constructor with no relation to any
// dist chunk, branded only via the shared global symbol registry — must
// also pass its message through unmasked. Deliberately re-derives the
// symbol with `Symbol.for` instead of importing anything from dist.
const TOOL_USER_ERROR_BRAND = Symbol.for('ampless.mcp.toolUserError')

class ForeignToolUserError extends Error {
  [TOOL_USER_ERROR_BRAND] = true

  constructor(message) {
    super(message)
    this.name = 'ToolUserError'
  }
}

const foreignTool = {
  name: 'throw_foreign',
  description: 'throws a ToolUserError from an independent constructor',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    throw new ForeignToolUserError('foreign brand message')
  },
}

{
  const response = await callTool('throw_foreign', {}, [foreignTool], () => ({}))
  assert.equal(response.result.isError, true)
  assert.equal(response.result.content[0].text, 'foreign brand message')
}

// Case 3: same name, no brand — must be masked. The brand symbol, not the
// error's name, is what marks a message as client-safe.
const sameNameTool = {
  name: 'throw_same_name',
  description: 'throws an unbranded error named ToolUserError',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const err = new Error('secret internal detail')
    err.name = 'ToolUserError'
    throw err
  },
}

{
  const response = await callTool('throw_same_name', {}, [sameNameTool], () => ({}))
  assert.equal(response.result.isError, true)
  assert.equal(response.result.content[0].text, MASKED)
}

console.log('tool-user-error dist smoke: 3 cases passed')
