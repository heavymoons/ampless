/**
 * Server-side KvStore provider for SSR Lambda routes.
 *
 * The client-side `kv-provider.ts` calls `setKvStore()` from a `'use
 * client'` module, so it never runs in the SSR Lambda. API routes
 * (`/api/mcp`, `/api/admin/mcp-tokens`) that need KvStore access
 * therefore see the "No KvStore configured" error until this server
 * variant is installed.
 *
 * This implementation skips Amplify SSR cookies entirely and talks
 * straight to AppSync over HTTPS using the MCP service user's Cognito
 * id token — the same identity the MCP HTTP transport already uses.
 * That means:
 *   - the SSR Lambda needs the `AMPLESS_MCP_SERVICE_*` env vars set,
 *     same as for `/api/mcp`
 *   - the service user must be in `ampless-admin` so AppSync grants it
 *     read/write on the KvStore model
 *
 * Route-level guards (`requireAdminSession` in `mcp-tokens.ts`, Bearer
 * token validation in `mcp.ts`) gate WHO can issue Kv operations.
 * Identity for the DynamoDB write is always the service user.
 */

import { setKvStore, type KvItem, type KvStore } from 'ampless'
import type { AmplessOutputs } from '@ampless/runtime'
import { getMcpServiceAuth } from './mcp-service-auth.js'

const installed = new WeakSet<AmplessOutputs>()

/**
 * Install the server-side KvStore implementation into ampless's global
 * registry. Idempotent per outputs instance — first call wires it,
 * subsequent calls no-op. Safe to call at route-factory time even
 * though the global is shared across requests, because the
 * implementation reads outputs / serviceAuth lazily inside each call.
 */
export function installServerKvProvider(outputs: AmplessOutputs): void {
  if (installed.has(outputs)) return
  installed.add(outputs)

  // Resolve lazily so a missing `data.url` only fails the FIRST Kv op
  // (clear runtime error in the route response) instead of crashing the
  // whole route module at import time.
  const serviceAuth = getMcpServiceAuth(outputs)

  async function gql<T>(operation: string, variables: Record<string, unknown>): Promise<T> {
    if (!outputs.data?.url) {
      throw new Error(
        '[kv-provider-server] amplify_outputs.json is missing data.url — KvStore is unreachable.'
      )
    }
    const appsyncUrl = outputs.data.url
    const idToken = await serviceAuth.getIdToken()
    const res = await fetch(appsyncUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // AppSync userPool auth: bare id token, no "Bearer" prefix.
        Authorization: idToken,
      },
      body: JSON.stringify({ query: operation, variables }),
    })
    const body = (await res.json()) as {
      data?: T
      errors?: Array<{ message: string }>
    }
    if (body.errors && body.errors.length > 0) {
      throw new Error(`[kv-provider-server] AppSync error: ${body.errors[0]!.message}`)
    }
    if (body.data === undefined) {
      throw new Error('[kv-provider-server] AppSync response had no `data` field')
    }
    return body.data
  }

  // AppSync stores `a.json()` as the AWSJSON scalar — a JSON-encoded
  // string on the wire. Match what `kv-provider.ts` does so values are
  // wire-compatible with admin client writes.
  function encodeValue(value: unknown): string {
    return JSON.stringify(value ?? null)
  }

  function decodeValue(raw: unknown): unknown {
    if (typeof raw !== 'string') return raw
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }

  interface RawRow {
    pk: string
    sk: string
    value?: unknown
    ttl?: number | null
  }

  const store: KvStore = {
    async get<T = unknown>(pk: string, sk: string): Promise<T | null> {
      const data = await gql<{ getKvStore: RawRow | null }>(
        `query GetKv($pk: String!, $sk: String!) {
          getKvStore(pk: $pk, sk: $sk) { pk sk value ttl }
        }`,
        { pk, sk }
      )
      const row = data.getKvStore
      return row ? (decodeValue(row.value) as T) : null
    },

    async query<T = unknown>(pk: string): Promise<KvItem<T>[]> {
      const data = await gql<{
        listKvStores: { items: RawRow[]; nextToken?: string | null }
      }>(
        `query QueryKv($filter: ModelKvStoreFilterInput, $limit: Int) {
          listKvStores(filter: $filter, limit: $limit) {
            items { pk sk value ttl }
            nextToken
          }
        }`,
        { filter: { pk: { eq: pk } }, limit: 1000 }
      )
      return data.listKvStores.items.map((row) => ({
        pk: row.pk,
        sk: row.sk,
        value: decodeValue(row.value) as T,
        ttl: row.ttl ?? undefined,
      }))
    },

    async put(pk, sk, value, opts) {
      const ttl = opts?.ttlSeconds
        ? Math.floor(Date.now() / 1000) + opts.ttlSeconds
        : null
      // Try update first; if no row exists, create. Mirrors the client
      // provider's upsert because AppSync's generated CRUD has no
      // upsert primitive.
      const existing = await gql<{ getKvStore: RawRow | null }>(
        `query GetKv($pk: String!, $sk: String!) {
          getKvStore(pk: $pk, sk: $sk) { pk sk }
        }`,
        { pk, sk }
      )
      if (existing.getKvStore) {
        await gql(
          `mutation UpdateKv($input: UpdateKvStoreInput!) {
            updateKvStore(input: $input) { pk sk }
          }`,
          { input: { pk, sk, value: encodeValue(value), ttl } }
        )
      } else {
        await gql(
          `mutation CreateKv($input: CreateKvStoreInput!) {
            createKvStore(input: $input) { pk sk }
          }`,
          { input: { pk, sk, value: encodeValue(value), ttl } }
        )
      }
    },

    async remove(pk, sk) {
      await gql(
        `mutation DeleteKv($input: DeleteKvStoreInput!) {
          deleteKvStore(input: $input) { pk sk }
        }`,
        { input: { pk, sk } }
      )
    },
  }

  setKvStore(store)
}
