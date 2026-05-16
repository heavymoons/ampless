// Wired-up admin UI factory. Single source of truth for the admin
// library — every admin route shell, API route shell, and form
// re-export shim imports the `admin` value from here.
//
// L2 architectural change (admin extraction): admin UI now lives in
// `@ampless/admin`. This module wires the project's
// `amplify_outputs.json`, `cms.config`, and `ampless` runtime into a
// single `Admin` instance.

import outputs from '../amplify_outputs.json'
import cmsConfig from '@/cms.config'
import { createAdmin } from '@ampless/admin'
import { ampless } from './ampless'

export const admin = createAdmin({
  outputs,
  cmsConfig,
  ampless,
  locale: (cmsConfig as { locale?: string }).locale ?? 'en',
})

// Convenience: the server-side translation helper. Client components
// should use `useT()` from `@/components/i18n-provider` instead.
export const t = admin.t
