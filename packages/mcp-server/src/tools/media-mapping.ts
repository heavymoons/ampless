import type { StorageClient } from './types.js'

/**
 * Fields projected by `list_media` / `search_media` from the
 * auto-generated `listMedia` query. `createdAt` / `updatedAt` are
 * Amplify-managed DynamoDB attributes set on every write — they appear
 * on the model even though they aren't declared in the schema's
 * `a.model({...})` block.
 */
export const MEDIA_FIELDS = /* GraphQL */ `
  fragment MediaFields on Media {
    mediaId
    src
    mimeType
    size
    createdAt
    updatedAt
  }
`

/** Raw Media row shape returned by the `listMedia` query. */
export interface MediaRow {
  mediaId: string
  src: string
  mimeType: string
  size: number | null
  createdAt: string
  updatedAt: string
}

/** Public-facing media result, with a derived public URL. */
export interface MediaResult {
  mediaId: string
  src: string
  /** Public S3 URL — same format `upload_media` returns. */
  url: string
  mimeType: string
  size: number | null
  createdAt: string
  updatedAt: string
}

/**
 * Map a raw Media row to the tool result shape, deriving `url` from
 * `src` via the storage client (pure string formatting — no S3 call).
 */
export function toMediaResult(row: MediaRow, storage: StorageClient): MediaResult {
  return {
    mediaId: row.mediaId,
    src: row.src,
    url: storage.publicUrl(row.src),
    mimeType: row.mimeType,
    size: row.size,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
