// Back-compat shim. Storage URL helpers moved to `@ampless/runtime`.
// New code should call `ampless.publicAssetUrl` / `ampless.isStorageConfigured` directly.

import { ampless } from './ampless'

export const publicAssetUrl = ampless.publicAssetUrl.bind(ampless)
export const isStorageConfigured = ampless.isStorageConfigured.bind(ampless)
