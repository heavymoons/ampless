import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { formatPublicAssetUrl } from 'ampless'
import type { StorageObject } from './tools/types.js'
import type { AmplifyOutputs } from './types.js'

// `sanitizeName` / `buildMediaKey` moved to `./tools/media-key.ts` so
// the tools sub-export doesn't transitively pull `@aws-sdk/client-s3`
// into consumers. Re-exported here for source-compatible callers.
export { sanitizeName, buildMediaKey } from './tools/media-key.js'

export class StorageClient {
  private readonly client: S3Client
  private readonly bucket: string
  private readonly region: string

  constructor(outputs: AmplifyOutputs) {
    if (!outputs.storage) {
      throw new Error(
        'mcp-server: amplify_outputs.json has no `storage` block. Deploy the storage resource first.'
      )
    }
    this.bucket = outputs.storage.bucket_name
    this.region = outputs.storage.aws_region
    // Uses the default credential chain (AWS profile / env vars / instance
    // role). The MCP server is expected to run on the user's machine where
    // `aws configure` has been done, same as `npx ampx sandbox`.
    this.client = new S3Client({ region: this.region })
  }

  async putObject(key: string, body: Uint8Array, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    )
    return formatPublicAssetUrl(this.bucket, this.region, key)
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    )
  }

  async listObjects(prefix: string): Promise<StorageObject[]> {
    const out: StorageObject[] = []
    let token: string | undefined
    // Paginate so the static-bundle tools always see the full prefix —
    // S3 ListObjectsV2 caps at 1000 entries per call.
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
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
  }
}
