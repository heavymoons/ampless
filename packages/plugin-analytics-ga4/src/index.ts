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
  /**
   * Optional consent category. When set, the analytics loader does
   * not run until window.amplessConsent.has(consentCategory) returns
   * true. See @ampless/plugin-cookie-consent and the Consent
   * Convention in docs/architecture/08-plugin-architecture.md.
   */
  consentCategory?: string
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
  const {
    measurementId = '',
    instanceId = 'analytics-ga4',
    consentCategory = '',
  } = options
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
        {
          type: 'text',
          key: 'consentCategory',
          label: { en: 'Consent category', ja: '同意カテゴリ' },
          description: {
            en: 'Optional. When set, the analytics loader fires only after `window.amplessConsent.has(<this>)` returns true. Requires `@ampless/plugin-cookie-consent` to also be registered — fail-closed otherwise (no tracking, console warning after 5s). See the Consent Convention in the plugin author guide.',
            ja: 'オプション。設定すると `window.amplessConsent.has(<value>)` が true になるまで analytics loader を発火しません。`@ampless/plugin-cookie-consent` の併用が必須 — 未導入時は完全に発火せず 5 秒後に console warning (fail-closed)。詳細は plugin author guide の Consent Convention 節を参照。',
          },
          pattern: '^$|^[a-z][a-z0-9_-]*$',
          maxLength: 32,
          placeholder: 'analytics',
          default: consentCategory,
        },
      ],
    },
    publicHead(ctx) {
      const id = (ctx.setting<string>('measurementId') ?? '').trim()
      // Empty measurementId → no descriptors. Lets consumers leave
      // the plugin registered while toggling analytics off without
      // changing the plugin list.
      if (!id) return []

      const category = (ctx.setting<string>('consentCategory') ?? '').trim()

      // Non-empty consentCategory → gated mode: collapse the two
      // standard descriptors into a single inlineScript that defers
      // loading until window.amplessConsent.has(category) is true.
      if (category) {
        const loaderSrc = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`
        return [
          {
            type: 'inlineScript',
            id: `ga4-gated-${instanceId}`,
            strategy: 'afterInteractive',
            body: [
              '(function () {',
              '  var initialized = false',
              '  function init() {',
              '    if (initialized) return',
              '    initialized = true',
              '    var s = document.createElement(\'script\')',
              `    s.src = ${JSON.stringify(loaderSrc)}`,
              '    s.async = true',
              '    document.head.appendChild(s)',
              '    window.dataLayer = window.dataLayer || []',
              '    function gtag(){dataLayer.push(arguments)}',
              '    gtag(\'js\', new Date())',
              `    gtag('config', ${JSON.stringify(id)})`,
              '  }',
              '  function wait() {',
              `    if (window.amplessConsent.has(${JSON.stringify(category)})) init()`,
              `    else window.amplessConsent.on(${JSON.stringify(category)}, init)`,
              '  }',
              '  if (window.amplessConsent) {',
              '    wait()',
              '  } else {',
              '    window.addEventListener(\'ampless:consent-ready\', wait, { once: true })',
              '    setTimeout(function () {',
              '      if (!window.amplessConsent) {',
              '        console.warn(\'[ampless:analytics-ga4] consentCategory is set but window.amplessConsent never installed. Did you forget to register @ampless/plugin-cookie-consent?\')',
              '      }',
              '    }, 5000)',
              '  }',
              '})()',
            ].join('\n'),
          },
        ]
      }

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
