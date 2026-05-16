import { formatPublicAssetUrl } from 'ampless'
import type { AmplessOutputs, StorageOutput } from './outputs.js'

export interface StorageApi {
  publicAssetUrl(key: string): string
  isStorageConfigured(): boolean
}

/**
 * Build the runtime's storage helpers from the user-provided
 * `amplify_outputs.json` shape. Throws (via `publicAssetUrl`) if the
 * sandbox hasn't been deployed yet — a deploy-time precondition, not a
 * runtime branch, so callers shouldn't need to null-check.
 */
export function createStorage(outputs: AmplessOutputs): StorageApi {
  const storage: StorageOutput | null = outputs.storage ?? null

  return {
    publicAssetUrl(key: string): string {
      if (!storage) {
        throw new Error(
          'amplify storage output missing — run `npx ampx sandbox` (or deploy) before invoking this code path'
        )
      }
      return formatPublicAssetUrl(storage.bucket_name, storage.aws_region, key)
    },
    isStorageConfigured(): boolean {
      return storage !== null
    },
  }
}
