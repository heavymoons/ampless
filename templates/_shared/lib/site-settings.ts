// Back-compat shim. Site-settings loader moved to `@ampless/runtime`.
// New code should call `ampless.loadSiteSettings` directly.

import { ampless } from './ampless'

// Arrow wrapper: defer `ampless` resolution to call time (avoid TDZ in
// the themes-registry → theme → shim → ampless circular import chain).
export const loadSiteSettings: typeof ampless.loadSiteSettings =
  (...args) => ampless.loadSiteSettings(...args)

export type { EffectiveSiteSettings } from '@ampless/runtime'
