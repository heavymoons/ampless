// @ampless/admin — admin UI library for ampless.
//
// Templates wire this up once in `lib/admin.ts`:
//
//     import outputs from '../amplify_outputs.json'
//     import cmsConfig from '../cms.config'
//     import { createAdmin } from '@ampless/admin'
//     import { ampless } from './ampless'
//
//     export const admin = createAdmin({ outputs, cmsConfig, ampless })
//     export const t = admin.t
//
// and then hand the resulting `Admin` instance to page factories /
// route factories (see `@ampless/admin/pages`, `@ampless/admin/api`).

import type { Config } from 'ampless'
import type {
  Ampless,
  AmplessOutputs,
  EffectiveSiteSettings,
  EffectiveThemeConfig,
} from '@ampless/runtime'
import {
  resolveLocale,
  translate,
  type Dictionary,
  type Locale,
} from './lib/i18n.js'
import { createMedia } from './lib/media.js'
import { createAmplifyServer, type AmplifyServer } from './lib/amplify-server.js'
import { createAuthServer, type ServerSession } from './lib/auth-server.js'

export { getDictionary, translate, resolveLocale } from './lib/i18n.js'
export type { AdminLocaleStrings, Locale, Dictionary } from './lib/i18n.js'
export type { ServerSession } from './lib/auth-server.js'

export interface CreateAdminOpts {
  outputs: AmplessOutputs
  cmsConfig: Config
  /**
   * Optional pre-built ampless runtime instance for cross-package
   * sharing. Accepts either the instance itself OR a thunk (sync or
   * async). The thunk form is the recommended one for the template
   * scaffold's `lib/admin.ts` — it lets the consumer break the
   * `lib/admin.ts → lib/ampless.ts → themes-registry → … → lib/admin.ts`
   * static-import cycle by lazily resolving `ampless` via `import()`
   * inside the thunk body (the module isn't loaded until the first
   * `loadSiteSettings` / `loadThemeConfig` call, by which time all
   * other modules have finished initialising).
   *
   * When omitted, server pages that depend on settings / theme config
   * throw at request time.
   */
  ampless?: Ampless | (() => Ampless | Promise<Ampless>)
  /**
   * Locale for admin UI strings. Pass a string code ('en', 'ja') for a
   * built-in dictionary, or an object literal to override specific
   * strings. Defaults to English.
   */
  locale?: string | Record<string, unknown>
}

export interface Admin {
  // i18n
  t(key: string, vars?: Record<string, string | number>): string
  readonly locale: Locale
  readonly dict: Dictionary

  // server-side helpers (Cognito-authenticated)
  getServerSession(): Promise<ServerSession | null>
  isAdmin(session: ServerSession | null): boolean
  isEditor(session: ServerSession | null): boolean
  readonly amplifyServer: AmplifyServer

  // settings / theme passthroughs (require `ampless` opt; throw otherwise).
  loadSiteSettings(): Promise<EffectiveSiteSettings>
  loadThemeConfig(): Promise<EffectiveThemeConfig>

  // media
  publicMediaUrl(input: string): string

  // shape for handing to page / API factories
  readonly outputs: AmplessOutputs
  readonly cmsConfig: Config
  readonly ampless: Ampless | null
}

/**
 * Wire up the admin UI from user-supplied config blobs. Returns an
 * `Admin` instance containing everything page / API factories need —
 * the same instance is shared by `<AdminLayout>`, `<PostForm>`,
 * `/api/media`, etc.
 *
 * If `opts.ampless` is omitted, server-side pages that depend on
 * `loadSiteSettings` / `loadThemeConfig` (the site edit and theme
 * pages) will throw. Pass the same runtime instance you already use on
 * the public side for shared caching.
 */
export function createAdmin(opts: CreateAdminOpts): Admin {
  const { outputs, cmsConfig, ampless: amplessIn, locale: localeOpt } = opts

  const { locale, dict } = resolveLocale(localeOpt)
  const amplifyServer = createAmplifyServer(outputs)
  const auth = createAuthServer(amplifyServer)
  const media = createMedia(outputs, cmsConfig)

  // The runtime is optional — pages that don't touch settings (login,
  // dashboard, posts list / new / edit, media) don't need it. The two
  // server-rendered settings pages do; they call through these
  // passthroughs.
  //
  // When the caller passes a thunk (the recommended form for the
  // scaffolded `lib/admin.ts`), the resolved instance is cached after
  // the first call so subsequent calls don't re-invoke the thunk.
  let amplessCache: Ampless | null = null
  async function resolveAmpless(): Promise<Ampless> {
    if (amplessCache) return amplessCache
    if (amplessIn === undefined || amplessIn === null) {
      throw new Error(
        '[@ampless/admin] createAdmin was called without an `ampless` runtime ' +
          'instance, but a method that needs one (loadSiteSettings / loadThemeConfig) ' +
          'was invoked. Pass `ampless` in the `createAdmin` options so admin can ' +
          'reuse your public-side runtime.'
      )
    }
    const resolved = typeof amplessIn === 'function' ? await amplessIn() : amplessIn
    amplessCache = resolved
    return resolved
  }

  // Eagerly resolved form exposed on `admin.ampless` for callers that
  // need synchronous access. Falls back to `null` when the thunk form
  // is used — those callers should call the higher-level methods on
  // `admin` instead, which handle the async resolve internally.
  const eagerAmpless: Ampless | null =
    amplessIn !== undefined && amplessIn !== null && typeof amplessIn !== 'function'
      ? amplessIn
      : null

  return {
    t: (key, vars) => translate(dict, key, vars),
    locale,
    dict,

    getServerSession: auth.getServerSession,
    isAdmin: auth.isAdmin,
    isEditor: auth.isEditor,
    amplifyServer,

    loadSiteSettings: async () => (await resolveAmpless()).loadSiteSettings(),
    loadThemeConfig: async () => (await resolveAmpless()).loadThemeConfig(),

    publicMediaUrl: media.publicMediaUrl,

    outputs,
    cmsConfig,
    ampless: eagerAmpless,
  }
}
