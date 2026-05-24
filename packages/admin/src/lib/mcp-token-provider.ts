'use client'

import { generateClient } from 'aws-amplify/api'

import { setMcpTokenStore, type McpTokenRow, type McpTokenStore } from './mcp-token-store.js'

interface ModelResult<T> {
  data: T | null
  errors?: Array<{ message?: string }> | null
}

interface ListResult<T> {
  data: T[]
  errors?: Array<{ message?: string }> | null
}

interface McpTokenModel {
  get(args: { hash: string }): Promise<ModelResult<McpTokenRow>>
  list(args?: { limit?: number; nextToken?: string }): Promise<ListResult<McpTokenRow>>
  create(args: McpTokenRow): Promise<ModelResult<McpTokenRow>>
  update(args: McpTokenRow): Promise<ModelResult<McpTokenRow>>
  delete(args: { hash: string }): Promise<ModelResult<McpTokenRow>>
}

interface DataClientShape {
  models: {
    McpToken?: McpTokenModel
  }
}

let installed = false

/**
 * Install the admin McpToken provider into the module-local registry.
 * Idempotent — only the first call wires it. Invoked once from the
 * admin layout factory so the `/admin/mcp-tokens` page can list,
 * create, and revoke tokens.
 *
 * The underlying AppSync model carries `allow.groups(['ampless-admin'])`
 * so the AppSync layer rejects writes from any other role; this
 * provider just shapes the generated client into the
 * admin-internal `McpTokenStore` interface.
 */
export function installAdminMcpTokenProvider(): void {
  if (installed) return
  installed = true

  const client = generateClient() as unknown as DataClientShape

  function requireModel(): McpTokenModel {
    const m = client.models.McpToken
    if (!m) {
      throw new Error(
        'McpToken model is not available on the AppSync client. ' +
          'Did you redeploy the sandbox? Run `npx ampx sandbox` and wait ' +
          'for it to finish, then reload this page.'
      )
    }
    return m
  }

  const store: McpTokenStore = {
    async list(): Promise<McpTokenRow[]> {
      const model = requireModel()
      const { data } = await model.list({ limit: 1000 })
      return data ?? []
    },

    async get(hash: string): Promise<McpTokenRow | null> {
      const model = requireModel()
      const { data } = await model.get({ hash })
      return data ?? null
    },

    async put(row: McpTokenRow): Promise<void> {
      const model = requireModel()
      const existing = await model.get({ hash: row.hash })
      if (existing.data) {
        const { errors } = await model.update(row)
        if (errors) throw new Error(errors[0]?.message ?? 'McpToken.update failed')
      } else {
        const { errors } = await model.create(row)
        if (errors) throw new Error(errors[0]?.message ?? 'McpToken.create failed')
      }
    },

    async remove(hash: string): Promise<void> {
      const model = requireModel()
      const { errors } = await model.delete({ hash })
      if (errors) throw new Error(errors[0]?.message ?? 'McpToken.delete failed')
    },
  }

  setMcpTokenStore(store)
}
