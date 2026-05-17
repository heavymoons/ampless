// Wired-up admin UI factory. Single source of truth for the admin
// library — every admin route shell, API route shell, and form
// re-export shim imports the `admin` value from here.
//
// L2 architectural change (admin extraction): admin UI now lives in
// `@ampless/admin`. This module wires the project's
// `amplify_outputs.json` and `cms.config` into a single `Admin`
// instance.
//
// NOTE: We intentionally do NOT pass an `ampless` instance to
// createAdmin. That would import `lib/ampless.ts`, which imports
// `themes-registry`, which (via theme pages → `lib/i18n.ts`) imports
// back to this file — a circular chain that crashes with a TDZ
// ReferenceError on `ampless` at module init. `createAdmin` builds
// its own internal Ampless when omitted, which is functionally
// equivalent for admin's needs.

import outputs from '../amplify_outputs.json'
import cmsConfig from '@/cms.config'
import { createAdmin } from '@ampless/admin'

export const admin = createAdmin({
  outputs,
  cmsConfig,
  locale: (cmsConfig as { locale?: string }).locale ?? 'en',
})

// Convenience: the server-side translation helper. Client components
// should use `useT()` from `@/components/i18n-provider` instead.
export const t = admin.t
