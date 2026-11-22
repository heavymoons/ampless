// Test-only fixture. `defineStorage` must be called from a file whose
// path ends in `amplify/storage/resource` (Amplify's import-path verifier).
import { defineStorage } from '@aws-amplify/backend'
import { amplessStorageConfig } from '../../../storage/index.js'

export function makeStorage(): unknown {
  return defineStorage(amplessStorageConfig())
}
