// Back-compat shim. Server-side admin-site helpers moved to
// `@ampless/admin` (L2 extraction). New code should call the same
// methods on the `admin` instance directly.

import { admin } from './admin'

// Arrow wrappers: defer `admin` resolution to call time (avoid TDZ in
// case of circular import chains touching admin shims).
export const currentAdminSiteId: typeof admin.currentAdminSiteId =
  (...args) => admin.currentAdminSiteId(...args)
export const adminSiteOptions: typeof admin.adminSiteOptions =
  (...args) => admin.adminSiteOptions(...args)
