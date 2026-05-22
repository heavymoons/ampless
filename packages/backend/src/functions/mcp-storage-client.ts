import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { formatPublicAssetUrl } from 'ampless'
import type { StorageClient } from '@ampless/mcp-server/tools'

export interface CreateMcpStorageClientOpts {
  bucket: string
  region: string
}

/**
 * StorageClient impl for the HTTP MCP transport Lambda. Uses the
 * Lambda execution role's credentials (no AWS_ACCESS_KEY_ID env
 * needed); `backend.ts` grants `s3:PutObject` on the bucket's
 * `public/media/*` prefix scope. The bucket name + region arrive as
 * env vars rather than via `amplify_outputs.json` — the Lambda
 * doesn't read that file at runtime, the outputs are baked into env
 * at CDK synth time.
 */
export function createMcpStorageClient(opts: CreateMcpStorageClientOpts): StorageClient {
  const client = new S3Client({ region: opts.region })
  return {
    async putObject(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: opts.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        })
      )
      return formatPublicAssetUrl(opts.bucket, opts.region, key)
    },
  }
}
