import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { formatPublicAssetUrl } from 'ampless'
import type { AmplifyOutputs } from './types.js'

// Preserve Unicode (Japanese, emoji, etc.) — strip control chars and S3-
// hostile characters. Mirrors templates/blog/lib/upload.ts:sanitizeName.
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

export function buildMediaKey(filename: string, now: Date = new Date()): string {
  const safe = sanitizeName(filename)
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  return `public/media/${yyyy}/${mm}/${now.getTime()}-${safe}`
}

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
}
