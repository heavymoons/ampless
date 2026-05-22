'use client'

import { generateClient } from 'aws-amplify/api'
import { decodeAwsJson, encodeAwsJson, setKvStore, type KvItem, type KvStore } from 'ampless'

interface KvRow {
  pk: string
  sk: string
  value?: unknown
  ttl?: number | null
}

interface ModelResult<T> {
  data: T | null
  errors?: Array<{ message?: string }> | null
}

interface ListResult<T> {
  data: T[]
  errors?: Array<{ message?: string }> | null
}

interface KvStoreModel {
  get(args: { pk: string; sk: string }): Promise<ModelResult<KvRow>>
  list(args?: {
    filter?: Record<string, unknown>
    limit?: number
  }): Promise<ListResult<KvRow>>
  create(args: Record<string, unknown>): Promise<ModelResult<KvRow>>
  update(args: Record<string, unknown>): Promise<ModelResult<KvRow>>
  delete(args: { pk: string; sk: string }): Promise<ModelResult<KvRow>>
}

interface DataClientShape {
  models: {
    KvStore?: KvStoreModel
  }
}

let installed = false

/**
 * Install the admin KvStore provider into ampless's global registry.
 * Idempotent — only the first call wires it. Invoked once from the
 * admin layout factory so every admin client component (which calls
 * `getSiteSetting`, `setSiteSetting`, etc.) hits this provider.
 *
 * The underlying KvStore AppSync model is shared with the trusted
 * processor, but admin-side writes are filtered by the AppSync
 * authorisation rule to the `ampless-admin` Cognito group.
 */
export function installAdminKvProvider(): void {
  if (installed) return
  installed = true

  const client = generateClient() as unknown as DataClientShape

  // `client.models.KvStore` is undefined when the AppSync schema hasn't
  // been redeployed since the model was added. The native error
  // ("Cannot read properties of undefined (reading 'get')") is opaque,
  // so wrap every entry point with a check that points at the actual
  // fix — running `npx ampx sandbox` again.
  function requireModel(): KvStoreModel {
    const m = client.models.KvStore
    if (!m) {
      throw new Error(
        'KvStore model is not available on the AppSync client. ' +
          'Did you redeploy the sandbox? Run `npx ampx sandbox` and wait ' +
          'for it to finish, then reload this page.'
      )
    }
    return m
  }

  // The `value` column is an `a.json()` field — see
  // `packages/ampless/src/awsjson.ts` for the wire-format rules
  // (`encodeAwsJson` / `decodeAwsJson`).

  const store: KvStore = {
    async get<T = unknown>(pk: string, sk: string): Promise<T | null> {
      const model = requireModel()
      const { data } = await model.get({ pk, sk })
      return data ? (decodeAwsJson(data.value) as T) : null
    },

    async query<T = unknown>(pk: string): Promise<KvItem<T>[]> {
      const model = requireModel()
      // KvStore identifier is [pk, sk], so list-with-filter on pk
      // walks just that partition.
      const { data } = await model.list({
        filter: { pk: { eq: pk } },
        limit: 1000,
      })
      return (data ?? []).map((row) => ({
        pk: row.pk,
        sk: row.sk,
        value: decodeAwsJson(row.value) as T,
        ttl: row.ttl ?? undefined,
      }))
    },

    async put(pk, sk, value, opts) {
      const model = requireModel()
      const ttl = opts?.ttlSeconds
        ? Math.floor(Date.now() / 1000) + opts.ttlSeconds
        : undefined
      // Try update first; if the row doesn't exist, create. Amplify's
      // generated client doesn't have an upsert primitive.
      const existing = await model.get({ pk, sk })
      if (existing.data) {
        const { errors } = await model.update({
          pk,
          sk,
          value: encodeAwsJson(value),
          ttl: ttl ?? null,
        })
        if (errors) throw new Error(errors[0]?.message ?? 'KvStore.update failed')
      } else {
        const { errors } = await model.create({
          pk,
          sk,
          value: encodeAwsJson(value),
          ttl,
        })
        if (errors) throw new Error(errors[0]?.message ?? 'KvStore.create failed')
      }
    },

    async remove(pk, sk) {
      const model = requireModel()
      const { errors } = await model.delete({ pk, sk })
      if (errors) throw new Error(errors[0]?.message ?? 'KvStore.delete failed')
    },
  }

  setKvStore(store)
}
