import { formatPublicAssetUrl } from 'ampless'
import outputs from '../amplify_outputs.json'

interface StorageOutput {
  bucket_name: string
  aws_region: string
}

const storage = (outputs as { storage?: StorageOutput }).storage ?? null

/**
 * Returns the public S3 URL for an object key. Throws if the sandbox has
 * not been deployed yet — this is a deploy-time precondition, not a
 * runtime branch, so callers shouldn't need to null-check.
 */
export function publicAssetUrl(key: string): string {
  if (!storage) {
    throw new Error(
      'amplify storage output missing — run `npx ampx sandbox` (or deploy) before invoking this code path'
    )
  }
  return formatPublicAssetUrl(storage.bucket_name, storage.aws_region, key)
}

export function isStorageConfigured(): boolean {
  return storage !== null
}
