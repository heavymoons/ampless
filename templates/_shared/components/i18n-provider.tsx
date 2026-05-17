'use client'

// Back-compat shim. I18n provider + hooks moved to `@ampless/admin`
// (L2 extraction). The component tree mounts the provider inside the
// admin layout factory; the root layout in `app/layout.tsx` still
// wraps the public site in this same provider to keep client-side
// `useT()` calls working from theme-side components too.
//
// The `'use client'` directive is needed because the bundled
// @ampless/admin/components ESM strips per-file 'use client' (tsup
// default behaviour). This shim re-establishes a client boundary so
// Next.js doesn't try to evaluate the React hooks inside an RSC
// server context.

export { I18nProvider, useT, useLocale } from '@ampless/admin/components'
