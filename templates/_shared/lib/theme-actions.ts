// Back-compat shim. Theme cache invalidation Server Action moved to
// `@ampless/admin`. The `'use server'` directive lives on the
// underlying admin module; this file is a plain re-export.

export { invalidateSiteSettingsCache } from '@ampless/admin/components'
