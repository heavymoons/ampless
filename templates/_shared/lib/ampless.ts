// Wired-up ampless runtime instance. Single source of truth for the
// public-side library — every route handler, dispatcher, and theme
// component imports the `ampless` value from here. Public-side
// behaviour lives in `@ampless/runtime`; this module wires the
// project's `amplify_outputs.json`, `cms.config`, and themes registry
// into a single `Ampless` instance.

import outputs from '../amplify_outputs.json'
import cmsConfig from '@/cms.config'
import { themes, DEFAULT_THEME } from '@/themes-registry'
import { createAmpless } from '@ampless/runtime'

export const ampless = createAmpless({
  outputs,
  cmsConfig,
  themes: { themes, defaultTheme: DEFAULT_THEME },
})
