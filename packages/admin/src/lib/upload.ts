'use client'

import { uploadData } from 'aws-amplify/storage'
import { generateClient } from 'aws-amplify/api'
import { encodeAwsJson, type MediaMetadata } from 'ampless'
import { processImage } from 'ampless/media'
import type { ProcessOptions } from 'ampless/media'
import { publicMediaUrl } from './media.js'

// Preserve Unicode (Japanese, emoji, etc.) — strip control chars and the
// characters S3 / URLs reject.
export function sanitizeName(name: string): string {
  return (
    name
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f]/g, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^\.+/, '_')
      .slice(0, 200) || 'upload'
  )
}

// Minimal structural shape of the AppSync data client surface this
// module needs. Mirrors the schema-agnostic pattern used by
// `posts-provider.ts` — admin doesn't depend on the user's generated
// `Schema` type, just the model methods it actually invokes.

interface MediaRow {
  mediaId: string
  src: string
  mimeType: string
  size?: number | null
  delivery?: string | null
  metadata?: unknown
}

interface ModelResult<T> {
  data: T | null
  errors?: Array<{ message?: string }> | null
}

interface MediaModel {
  create(args: Record<string, unknown>): Promise<ModelResult<MediaRow>>
}

interface DataClientShape {
  models: {
    Media?: MediaModel
  }
}

/**
 * Create a Media DynamoDB row for an asset already written to S3.
 * Used by the browser upload paths so the public `/api/media/...`
 * route's `getMediaBySrc` lookup hits a row on cold reads and skips
 * a HEAD round-trip.
 *
 * Errors are logged and swallowed — the upload itself already
 * succeeded (the S3 object exists), so failing the entire flow on a
 * GraphQL hiccup would leave the user with no way to use the file
 * they just uploaded. Missing Media rows fall through to the
 * media-proxy route's HEAD fallback path.
 */
export async function createMediaRow(input: {
  src: string
  mimeType: string
  size: number
  etag?: string
}): Promise<void> {
  try {
    const client = generateClient() as unknown as DataClientShape
    const model = client.models.Media
    if (!model) {
      // Sandbox not redeployed since the Media model was added /
      // changed. Same opaque-error workaround the KV provider uses.
      console.error(
        '[upload.createMediaRow] Media model not available on the AppSync client. ' +
          'Run `npx ampx sandbox` and wait for it to finish, then retry the upload.',
      )
      return
    }
    const metadata: MediaMetadata = {}
    if (input.etag) metadata.etag = input.etag
    const mediaId = `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const { errors } = await model.create({
      mediaId,
      src: input.src,
      mimeType: input.mimeType,
      size: input.size,
      delivery: 'nextjs',
      metadata: encodeAwsJson(metadata),
    })
    if (errors && errors.length > 0) {
      console.error(
        `[upload.createMediaRow] createMedia errors for ${input.src}`,
        errors.map((e) => e.message),
      )
    }
  } catch (err) {
    console.error(`[upload.createMediaRow] threw for ${input.src}`, err)
  }
}

/**
 * Run the image through processImage (crop/resize/encode) and upload the
 * result to S3 under `public/media/YYYY/MM/`. Records a Media
 * DynamoDB row with size + mimeType + etag so the public media-proxy
 * route can stream the bytes back without a HEAD round-trip. Returns
 * a stable public URL.
 *
 * Used by both /admin/media (gallery uploads) and the editor's MediaPicker
 * (upload-and-embed) so the storage layout and naming stay consistent.
 */
export async function uploadProcessedImage(
  file: File,
  options: ProcessOptions
): Promise<{ path: string; url: string }> {
  const processed = await processImage(file, options)
  const safeName = sanitizeName(processed.suggestedName)
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const path = `public/media/${yyyy}/${mm}/${Date.now()}-${safeName}`
  // `uploadData(...).result` resolves to a StorageItem carrying
  // `eTag` + `size` on success. Forward those into the Media row so
  // the read path can passthrough ETag headers and skip HEAD.
  const item = await uploadData({
    path,
    data: processed.blob,
    options: { contentType: processed.mime },
  }).result
  await createMediaRow({
    src: path,
    mimeType: processed.mime,
    size: item.size ?? processed.blob.size,
    etag: item.eTag,
  })
  return { path, url: publicMediaUrl(path) }
}
