// Back-compat shim. Storage URL helpers moved to `@ampless/runtime`.
// New code should call `ampless.publicAssetUrl` / `ampless.isStorageConfigured` directly.

import { ampless } from './ampless'

// Arrow wrappers: defer `ampless` resolution to call time (avoid TDZ).
export const publicAssetUrl: typeof ampless.publicAssetUrl =
  (...args) => ampless.publicAssetUrl(...args)
export const isStorageConfigured: typeof ampless.isStorageConfigured =
  (...args) => ampless.isStorageConfigured(...args)
