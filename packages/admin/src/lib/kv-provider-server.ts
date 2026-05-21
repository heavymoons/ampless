/**
 * Server-side KvStore provider for SSR Lambda routes.
 *
 * The client-side `kv-provider.ts` calls `setKvStore()` from a `'use
 * client'` module, so it never runs in the SSR Lambda. Server-side
 * routes that need KvStore access therefore see the "No KvStore
 * configured" error until this server variant is installed at the
 * route factory level.
 *
 * This implementation talks straight to AppSync over HTTPS using a
 * Cognito id token supplied by the caller. Install this provider in any
 * SSR route handler that needs KvStore access before performing KvStore
 * operations.
 *
 * NOTE: The `getIdToken` callback will be wired to a concrete auth
 * mechanism when the HTTP transport feature lands in v0.2 (API keys +
 * dedicated Lambda with IAM scoping). For now the provider is kept as
 * scaffolding so the export surface of `@ampless/admin/lib` stays stable.
 */

import { setKvStore, type KvItem, type KvStore } from 'ampless'
import type { AmplessOutputs } from '@ampless/runtime'

const installed = new WeakSet<AmplessOutputs>()

/**
 * Install the server-side KvStore implementation into ampless's global
 * registry. Idempotent per outputs instance — first call wires it,
 * subsequent calls no-op. Safe to call at route-factory time even
 * though the global is shared across requests, because the
 * implementation reads outputs / getIdToken lazily inside each call.
 *
 * @param outputs  Parsed `amplify_outputs.json` for this deployment.
 * @param getIdToken  Async function that returns a fresh Cognito id token
 *   with at least `ampless-admin` group membership.
 */
export function installServerKvProvider(
  outputs: AmplessOutputs,
  getIdToken: () => Promise<string>
): void {
  if (installed.has(outputs)) return
  installed.add(outputs)

  async function gql<T>(operation: string, variables: Record<string, unknown>): Promise<T> {
    if (!outputs.data?.url) {
      throw new Error(
        '[kv-provider-server] amplify_outputs.json is missing data.url — KvStore is unreachable.'
      )
    }
    const appsyncUrl = outputs.data.url
    const idToken = await getIdToken()
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
