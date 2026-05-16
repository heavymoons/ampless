// Back-compat shim. I18n provider + hooks moved to `@ampless/admin`
// (L2 extraction). The component tree mounts the provider inside the
// admin layout factory; the root layout in `app/layout.tsx` still
// wraps the public site in this same provider to keep client-side
// `useT()` calls working from theme-side components too.

export { I18nProvider, useT, useLocale } from '@ampless/admin/components'
