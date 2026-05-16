// Public-site middleware. Implementation moved to `@ampless/runtime`
// (L1 extraction); this file wires the project's `cms.config` into
// the factory and re-exports the default matcher.
//
// See `@ampless/runtime/middleware` for behaviour details: multi-site
// host rewrite, `<slug>.html` → raw route, `?previewTheme=` header
// forwarding, multi-site Cache-Control override.

import cmsConfig from './cms.config'
import { createAmplessMiddleware, defaultMatcherConfig } from '@ampless/runtime/middleware'

export const middleware = createAmplessMiddleware({ cmsConfig })
export const config = defaultMatcherConfig
