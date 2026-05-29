import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { formatPublicAssetUrl } from 'ampless'
import type { StorageClient, StorageObject } from '@ampless/mcp-server/tools'

export interface CreateMcpStorageClientOpts {
  bucket: string
  region: string
}

/**
 * StorageClient impl for the HTTP MCP transport Lambda. Uses the
 * Lambda execution role's credentials (no AWS_ACCESS_KEY_ID env
 * needed); `backend.ts` grants the appropriate S3 actions per
 * upload destination (media: `public/media/*`, static bundles:
 * `public/static/*`). The bucket name + region arrive as env vars
 * rather than via `amplify_outputs.json` — the Lambda doesn't read
 * that file at runtime, the outputs are baked into env at CDK synth
 * time.
 */
export function createMcpStorageClient(opts: CreateMcpStorageClientOpts): StorageClient {
  const client = new S3Client({ region: opts.region })
  return {
    async putObject(key, body, contentType) {
      const res = await client.send(
        new PutObjectCommand({
          Bucket: opts.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        })
      )
      // S3 returns ETag wrapped in double quotes — strip them so the
      // value matches what `getProperties` / `If-None-Match` clients
      // produce. May be undefined on rare SSE configurations; callers
      // treat that as "no etag available".
      const etag = res.ETag ? res.ETag.replace(/^"|"$/g, '') : undefined
      return {
        url: formatPublicAssetUrl(opts.bucket, opts.region, key),
        etag,
      }
    },
    async deleteObject(key) {
      await client.send(
        new DeleteObjectCommand({ Bucket: opts.bucket, Key: key })
      )
    },
    async listObjects(prefix) {
      const out: StorageObject[] = []
      let token: string | undefined
      // Paginate so the static-bundle tools always see the full prefix —
      // S3 ListObjectsV2 caps at 1000 entries per call.
      do {
        const res = await client.send(
          new ListObjectsV2Command({
            Bucket: opts.bucket,
            Prefix: prefix,
            ContinuationToken: token,
          })
        )
        for (const obj of res.Contents ?? []) {
          if (!obj.Key) continue
          out.push({
            key: obj.Key,
            size: obj.Size ?? 0,
            lastModified: obj.LastModified?.toISOString(),
          })
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined
      } while (token)
      return out
    },
    publicUrl(key) {
      return formatPublicAssetUrl(opts.bucket, opts.region, key)
    },
  }
}
