// Back-compat shim. Media URL helper moved to `@ampless/admin` (L2
// extraction). The client-side state is registered inside the admin's
// <AdminProviders> bootstrap; existing call sites
// (`publicMediaUrl(...)`) keep working through this shim.

export { publicMediaUrl } from '@ampless/admin/components'
