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
  const url = await storage.putObject(key, body, args.mimeType)

  const mediaId = `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const data = await graphql.query<{
    createMedia: {
      mediaId: string
      src: string
      mimeType: string
      size: number | null
      delivery: string | null
    }
  }>(MUTATION, {
    input: {
      mediaId,
      src: key,
      mimeType: args.mimeType,
      size: body.length,
      delivery: 'nextjs',
    },
  })

  return { media: data.createMedia, url }
}
