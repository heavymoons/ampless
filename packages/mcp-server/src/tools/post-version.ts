import { createHash } from 'node:crypto'
import type { Post } from 'ampless'

// Content version token for MCP posts: `'v1:' + sha256(canonical JSON)` of
// the post exactly as `toCorePost` produced it. `updatedAt` alone is not a
// safe version — the stock Amplify resolvers stamp it with millisecond
// precision, so a write in the same millisecond leaves it unchanged. The
// token hashes the content itself, so ANY change to these fields changes
// it, whatever happened to updatedAt.

/** The fields the token covers (every field `toCorePost` maps). */
export const POST_VERSION_FIELDS = [
  'postId',
  'title',
  'slug',
  'excerpt',
  'format',
  'body',
  'status',
  'publishedAt',
  'tags',
  'metadata',
  'updatedAt',
] as const

const PREFIX = 'v1:'

/** A post as the MCP tools return it: the core `Post` plus its content version. */
export type VersionedPost = Post & { version: string }

/**
 * Deterministic JSON: object keys sorted recursively, arrays kept in
 * order, `undefined` object values omitted (as JSON.stringify does) and
 * `undefined` array elements written as null (likewise).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const json = JSON.stringify(value)
    return json === undefined ? 'null' : json
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`
  const obj = value as Record<string, unknown>
  const parts: string[] = []
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key]
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue
    parts.push(`${JSON.stringify(key)}:${canonicalJson(v)}`)
  }
  return `{${parts.join(',')}}`
}

/** The content version of a post (only `POST_VERSION_FIELDS` count; absent ones are omitted). */
export function postVersion(post: Post): string {
  const picked: Record<string, unknown> = {}
  for (const field of POST_VERSION_FIELDS) picked[field] = post[field]
  return PREFIX + createHash('sha256').update(canonicalJson(picked)).digest('hex')
}

/** `post` with its `version` (any `version` already on it is recomputed). */
export function withVersion(post: Post): VersionedPost {
  return { ...post, version: postVersion(post) }
}
