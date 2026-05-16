// Back-compat shim. Site-settings loader moved to `@ampless/runtime`.
// New code should call `ampless.loadSiteSettings` directly.

import { ampless } from './ampless'

export const loadSiteSettings = ampless.loadSiteSettings.bind(ampless)

export type { EffectiveSiteSettings } from '@ampless/runtime'
