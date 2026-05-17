// Back-compat shim. Active-theme resolution moved to `@ampless/runtime`.
// New code should call `ampless.resolveActiveTheme` directly.

import { ampless } from './ampless'

// Arrow wrapper: defer `ampless` resolution to call time (avoid TDZ).
export const resolveActiveTheme: typeof ampless.resolveActiveTheme =
  (...args) => ampless.resolveActiveTheme(...args)

export type { ResolvedTheme } from '@ampless/runtime'
