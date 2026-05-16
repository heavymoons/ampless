// Back-compat shim. Server-side admin-site helpers moved to
// `@ampless/admin` (L2 extraction). New code should call the same
// methods on the `admin` instance directly.

import { admin } from './admin'

export const currentAdminSiteId = admin.currentAdminSiteId.bind(admin)
export const adminSiteOptions = admin.adminSiteOptions.bind(admin)
