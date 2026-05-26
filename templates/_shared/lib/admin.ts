// Wired-up admin UI factory. Single source of truth for the admin
// library — every admin route shell, API route shell, and form
// imports the `admin` value from here. Admin UI lives in
// `@ampless/admin`; this module wires the project's
// `amplify_outputs.json` and `cms.config` into a single `Admin`
// instance.
//
// NOTE: we pass `ampless` as a thunk (not the resolved instance) so we
// don't have a static `import './ampless'` at the top of this file.
// A static import would form the cycle
//   `lib/admin.ts → lib/ampless.ts → themes-registry → themes → lib/admin.ts`
// and crash with a TDZ ReferenceError on `ampless` at module init.
// The thunk uses dynamic `import()` so `lib/ampless.ts` only loads on
// the first `loadSiteSettings` / `loadThemeConfig` call (request
// time), by which point every module has finished initialising.

import outputs from '../amplify_outputs.json'
import cmsConfig from '@/cms.config'
import { createAdmin } from '@ampless/admin'

export const admin = createAdmin({
  outputs,
  cmsConfig,
  ampless: async () => (await import('./ampless')).ampless,
  locale: (cmsConfig as { locale?: string }).locale ?? 'en',
})

// Convenience: the server-side translation helper. Client components
// should use `useT()` from `@ampless/admin/components` instead.
export const t = admin.t
