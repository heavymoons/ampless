import { defineStorage } from '@aws-amplify/backend'
import { amplessStorageConfig } from '@ampless/backend'

// Provisions the ampless media + plugins bucket with guest read on
// `public/*` and admin/editor write on the matched prefixes. CORS and
// the bucket-level public-access policy are applied by
// defineAmplessBackend.
//
// `defineStorage` must be called from this file directly — Amplify Gen 2's
// import-path verifier requires it to live at amplify/storage/resource.ts.
// `amplessStorageConfig` just returns the props object.
export const storage = defineStorage(amplessStorageConfig())
