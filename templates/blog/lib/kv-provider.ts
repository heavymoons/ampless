import { generateClient } from 'aws-amplify/api'
import { setKvStore, type KvItem, type KvStore } from 'ampless'
import type { Schema } from '../amplify/data/resource'

const client = generateClient<Schema>()

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
    const { data } = await client.models.KvStore.get({ pk, sk })
    return data ? (decodeValue(data.value) as T) : null
  },

  async query<T = unknown>(pk: string): Promise<KvItem<T>[]> {
    // KvStore identifier is [pk, sk], so list-with-filter on pk
    // walks just that partition.
    const { data } = await client.models.KvStore.list({
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
    const ttl = opts?.ttlSeconds
      ? Math.floor(Date.now() / 1000) + opts.ttlSeconds
      : undefined
    // Try update first; if the row doesn't exist, create. Amplify's
    // generated client doesn't have an upsert primitive.
    const existing = await client.models.KvStore.get({ pk, sk })
    if (existing.data) {
      const { errors } = await client.models.KvStore.update({
        pk,
        sk,
        value: encodeValue(value),
        ttl: ttl ?? null,
      })
      if (errors) throw new Error(errors[0]?.message ?? 'KvStore.update failed')
    } else {
      const { errors } = await client.models.KvStore.create({
        pk,
        sk,
        value: encodeValue(value),
        ttl,
      })
      if (errors) throw new Error(errors[0]?.message ?? 'KvStore.create failed')
    }
  },

  async remove(pk, sk) {
    const { errors } = await client.models.KvStore.delete({ pk, sk })
    if (errors) throw new Error(errors[0]?.message ?? 'KvStore.delete failed')
  },
}

setKvStore(store)
