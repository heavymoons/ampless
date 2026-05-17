// Back-compat shim. Theme-config loader moved to `@ampless/runtime`.
// New code should call `ampless.loadThemeConfig` / `ampless.renderThemeCss` directly.

import { ampless } from './ampless'

// Arrow wrapper: defer `ampless` resolution to call time (avoid TDZ).
export const loadThemeConfig: typeof ampless.loadThemeConfig =
  (...args) => ampless.loadThemeConfig(...args)

export { renderThemeCss } from '@ampless/runtime'

export type { EffectiveThemeConfig } from '@ampless/runtime'
