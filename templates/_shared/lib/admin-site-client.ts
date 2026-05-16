// Back-compat shim. Client-side admin-site helpers moved to
// `@ampless/admin` (L2 extraction). Existing call sites
// (`readAdminSiteIdFromCookie`, the `ADMIN_SITE_COOKIE` constant) keep
// working through this shim — the cms.config registration is performed
// inside the admin's <AdminProviders> bootstrap.

export {
  ADMIN_SITE_COOKIE,
  readAdminSiteIdFromCookie,
} from '@ampless/admin/components'
