// Back-compat shim. Active-theme resolution moved to `@ampless/runtime`.
// New code should call `ampless.resolveActiveTheme` directly.

import { ampless } from './ampless'

export const resolveActiveTheme = ampless.resolveActiveTheme.bind(ampless)

export type { ResolvedTheme } from '@ampless/runtime'
