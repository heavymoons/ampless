import { defineAmplessStorage } from '@ampless/backend'

// Provisions the ampless media + plugins bucket with guest read on
// `public/*` and admin/editor write on the matched prefixes. CORS and
// the bucket-level public-access policy are applied by
// defineAmplessBackend.
export const storage = defineAmplessStorage()
