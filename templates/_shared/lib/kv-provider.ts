import { generateClient } from 'aws-amplify/api'
import { setKvStore, type KvItem, type KvStore } from 'ampless'
import type { Schema } from '../amplify/data/resource'

const client = generateClient<Schema>()

// `client.models.KvStore` is undefined when the AppSync schema hasn't
// been redeployed since the model was added. The native error
// ("Cannot read properties of undefined (reading 'get')") is opaque,
// so wrap every entry point with a check that points at the actual
// fix — running `npx ampx sandbox` again.
function requireModel() {
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

// AppSync stores `a.json()` as the AWSJSON scalar — a JSON-encoded
// string on the wire. Encode/decode to keep the API surface (KvStore
// interface) typed against `unknown` rather than strings.
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

const store: KvStore = {
  async get<T = unknown>(pk: string, sk: string): Promise<T | null> {
    const model = requireModel()
    const { data } = await model.get({ pk, sk })
    return data ? (decodeValue(data.value) as T) : null
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
      value: decodeValue(row.value) as T,
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
        value: encodeValue(value),
        ttl: ttl ?? null,
      })
      if (errors) throw new Error(errors[0]?.message ?? 'KvStore.update failed')
    } else {
      const { errors } = await model.create({
        pk,
        sk,
        value: encodeValue(value),
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
