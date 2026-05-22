import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { CognitoAuth } from './auth.js'
import { GraphqlClient } from './appsync.js'
import { StorageClient } from './s3.js'
import { tools, type ToolContext } from './tools/index.js'
import type { ResolvedConfig } from './types.js'

export async function startServer(config: ResolvedConfig): Promise<void> {
  const auth = new CognitoAuth(config)
  // Eager sign-in — fail fast on bad credentials before MCP handshake.
  await auth.signIn()

  const graphql = new GraphqlClient(config.outputs.data.url, auth)

  // Lazy storage: only constructed when a tool actually needs it, so users
  // who only call read tools don't trip on a missing storage block in
  // amplify_outputs.json.
  let storageClient: StorageClient | null = null
  const storage = (): StorageClient => {
    if (!storageClient) storageClient = new StorageClient(config.outputs)
    return storageClient
  }

  const ctx: ToolContext = {
    graphql,
    storage,
  }

  const server = new Server(
    { name: '@ampless/mcp-server', version: '0.0.1' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((t) => t.name === request.params.name)
    if (!tool) {
      throw new Error(`Unknown tool: ${request.params.name}`)
    }
    try {
      const result = await tool.handler(
        (request.params.arguments ?? {}) as Record<string, unknown>,
        ctx
      )
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: err instanceof Error ? err.message : String(err),
          },
        ],
      }
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
