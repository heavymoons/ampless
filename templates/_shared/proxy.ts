// Public-site proxy (Next.js 16 rename of "middleware"). Implementation
// moved to `@ampless/runtime` (L1 extraction); this file wires the
// project's `cms.config` into the factory and re-exports the default
// matcher. The runtime export name is still `createAmplessMiddleware`
// for API stability; only the user-side file convention (proxy.ts +
// `export const proxy`) follows Next 16's rename.
//
// See `@ampless/runtime/middleware` for behaviour details: multi-site
// host rewrite, `<slug>.html` → raw route, `?previewTheme=` header
// forwarding, multi-site Cache-Control override.

import cmsConfig from './cms.config'
import { createAmplessMiddleware, defaultMatcherConfig } from '@ampless/runtime/middleware'

export const proxy = createAmplessMiddleware({ cmsConfig })
export const config = defaultMatcherConfig
