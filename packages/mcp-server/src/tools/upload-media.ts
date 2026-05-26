import { encodeAwsJson, type MediaMetadata } from 'ampless'
import type { GraphqlClient, StorageClient } from './types.js'
import { buildMediaKey } from './media-key.js'

const MUTATION = /* GraphQL */ `
  mutation CreateMedia($input: CreateMediaInput!) {
    createMedia(input: $input) {
      mediaId
      src
      mimeType
      size
      delivery
      metadata
    }
  }
`

export interface UploadMediaArgs {
  filename: string
  mimeType: string
  /** Base64-encoded file body (no data: URL prefix). */
  base64Data: string
}

export const uploadMediaSchema = {
  type: 'object',
  required: ['filename', 'mimeType', 'base64Data'],
  properties: {
    filename: { type: 'string', description: 'Original filename; sanitized server-side' },
    mimeType: {
      type: 'string',
      description:
        'IANA media type (e.g. image/webp, image/jpeg). The MCP server does not transcode — pass the MIME of the bytes you actually send.',
    },
    base64Data: {
      type: 'string',
      description:
        'Base64-encoded file contents. NO data:URL prefix. The MCP server uploads bytes verbatim — resize/encode client-side first if needed.',
    },
  },
} as const

export async function uploadMedia(
  graphql: GraphqlClient,
  storage: StorageClient,
  args: UploadMediaArgs
) {
  const body = Buffer.from(args.base64Data, 'base64')
  const key = buildMediaKey(args.filename)
  const putResult = await storage.putObject(key, body, args.mimeType)

  // Record the S3 ETag in the Media row so the public media-proxy
  // route can passthrough it as a response header (enables 304
  // revalidation from CDN clients). Skipped silently when the
  // storage client didn't surface one — the Media row still works,
  // just without the etag hint.
  const metadata: MediaMetadata = {}
  if (putResult.etag) metadata.etag = putResult.etag

  const mediaId = `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const data = await graphql.query<{
    createMedia: {
      mediaId: string
      src: string
      mimeType: string
      size: number | null
      delivery: string | null
      metadata: unknown
    }
  }>(MUTATION, {
    input: {
      mediaId,
      src: key,
      mimeType: args.mimeType,
      size: body.length,
      delivery: 'nextjs',
      metadata: encodeAwsJson(metadata),
    },
  })

  return { media: data.createMedia, url: putResult.url }
}
