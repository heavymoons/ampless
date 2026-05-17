// Back-compat shim. Auth helpers moved to `@ampless/admin` (L2
// extraction). New code should call `admin.getServerSession` /
// `admin.isAdmin` / `admin.isEditor` directly.

import { admin } from './admin'

export type { ServerSession } from '@ampless/admin'

// Arrow wrappers: defer `admin` resolution to call time (avoid TDZ).
export const getServerSession: typeof admin.getServerSession =
  (...args) => admin.getServerSession(...args)
export const isAdmin: typeof admin.isAdmin =
  (...args) => admin.isAdmin(...args)
export const isEditor: typeof admin.isEditor =
  (...args) => admin.isEditor(...args)
