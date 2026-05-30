// @ampless/plugin-analytics-ga4 — first bundled plugin for the
// descriptor-based head injection API (Phase 1) and the first to
// migrate to admin-managed `settings.public` (Phase 2).
//
// Drops the two Google Analytics 4 snippets into `<head>`:
//
//   1. The async loader `<script src="https://www.googletagmanager.com/gtag/js?id=...">`
//   2. The inline init `<script>window.dataLayer = ...; gtag('config', '...')</script>`
//
// The runtime validates both descriptors before rendering (URL scheme
// check on (1), id-required check on (2)).
//
// Phase 2 reads the measurement ID at request time via
// `ctx.setting<string>('measurementId')`. The constructor still
// accepts `{ measurementId }` for backward compatibility and seeds the
// manifest `default`, but operators are encouraged to leave it empty
// and edit the live value from `/admin/plugins`.

import { definePlugin, type AmplessPlugin } from 'ampless'

export interface AnalyticsGa4Options {
  /**
   * Optional fallback Google Analytics 4 measurement ID, e.g.
   * `"G-XXXXXXXX"`. Used only when no admin-stored value exists in
   * `pk='siteconfig', sk='plugins.<instanceId>.measurementId'`. An
   * empty string disables the plugin (descriptors return `[]`),
   * which is the recommended way to keep the dependency wired up
   * while temporarily turning analytics off — for example in
   * staging or before consent is granted.
   *
   * The constructor argument will be removed in Phase 3. New
   * deployments should leave it empty and configure the value from
   * the admin UI.
   */
  measurementId?: string
  /**
   * Optional namespace for this instance. Defaults to
   * `'analytics-ga4'`. Set distinct values when registering the
   * plugin twice (e.g. a marketing + a product property on the same
   * site).
   */
  instanceId?: string
}

/**
 * Factory for the GA4 plugin. Returns a plugin manifest that emits
 * the two GA4 snippets via `publicHead`. The plugin is `untrusted` —
 * it does not need any AWS data permissions because everything
 * happens inside the public Next.js process at render time.
 */
export default function analyticsGa4Plugin(
  options: AnalyticsGa4Options = {}
): AmplessPlugin {
  const { measurementId = '', instanceId = 'analytics-ga4' } = options
  return definePlugin({
    name: 'analytics-ga4',
    packageName: '@ampless/plugin-analytics-ga4',
    instanceId,
    displayName: { en: 'Google Analytics 4', ja: 'Google Analytics 4' },
    apiVersion: 1,
    trust_level: 'untrusted',
    capabilities: ['publicHead', 'adminSettings'],
    settings: {
      public: [
        {
          type: 'text',
          key: 'measurementId',
          label: {
            en: 'Measurement ID',
            ja: '測定 ID',
          },
          description: {
            en: 'GA4 measurement ID (e.g. G-XXXXXXXX). Leave blank to disable the plugin without removing it from cms.config.',
            ja: 'GA4 の測定 ID (例: G-XXXXXXXX)。空にすると cms.config から削除せずにプラグインを無効化できます。',
          },
          // Accept either empty (disable) or a well-formed GA4
          // measurement id. The runtime's `publicHead` reads the
          // resolved value through ctx.setting and skips emitting
          // descriptors when it's empty.
          pattern: '^$|^G-[A-Z0-9]+$',
          placeholder: 'G-XXXXXXXX',
          default: measurementId,
        },
      ],
    },
    publicHead(ctx) {
      const id = (ctx.setting<string>('measurementId') ?? '').trim()
      // Empty measurementId → no descriptors. Lets consumers leave
      // the plugin registered while toggling analytics off without
      // changing the plugin list.
      if (!id) return []
      return [
        {
          type: 'script',
          id: `ga4-loader-${instanceId}`,
          src: `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(
            id
          )}`,
          strategy: 'afterInteractive',
        },
        {
          type: 'inlineScript',
          id: `ga4-init-${instanceId}`,
          strategy: 'afterInteractive',
          // Standard GA4 bootstrap. We JSON.stringify the measurement
          // ID so any future surprises (special characters in
          // measurement IDs, accidental quote injection) stay
          // contained.
          body: [
            'window.dataLayer = window.dataLayer || [];',
            'function gtag(){dataLayer.push(arguments);}',
            "gtag('js', new Date());",
            `gtag('config', ${JSON.stringify(id)});`,
          ].join('\n'),
        },
      ]
    },
  })
}
