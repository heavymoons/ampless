// Wired-up ampless runtime instance. Single source of truth for the
// public-side library — every route handler, dispatcher, and theme
// component imports the `ampless` value from here.
//
// L1 architectural change (runtime extraction): public-side
// behaviour now lives in `@ampless/runtime`. This module wires the
// project's `amplify_outputs.json`, `cms.config`, and themes registry
// into a single `Ampless` instance.
//
// Admin-side modules (post providers, kv-provider, auth, etc.) stay
// in `templates/_shared/lib/` for now — they move into `@ampless/admin`
// in L2.

import outputs from '../amplify_outputs.json'
import cmsConfig from '@/cms.config'
import { themes, DEFAULT_THEME } from '@/themes-registry'
import { createAmpless } from '@ampless/runtime'

export const ampless = createAmpless({
  outputs,
  cmsConfig,
  themes: { themes, defaultTheme: DEFAULT_THEME },
})
