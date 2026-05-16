// Back-compat shim. Theme-config loader moved to `@ampless/runtime`.
// New code should call `ampless.loadThemeConfig` / `ampless.renderThemeCss` directly.

import { ampless } from './ampless'

export const loadThemeConfig = ampless.loadThemeConfig.bind(ampless)

export { renderThemeCss } from '@ampless/runtime'

export type { EffectiveThemeConfig } from '@ampless/runtime'
