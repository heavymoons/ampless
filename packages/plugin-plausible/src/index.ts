// @ampless/plugin-plausible — Plausible Analytics plugin. The
// minimal-shape companion to the GTM dogfood in Phase 3a: a single
// `<script>` descriptor in `<head>`, two admin-managed settings,
// privacy-focused (no cookies, no GDPR consent typically needed).
//
// The plugin exercises three corners of the Phase 1/2 surface that
// GA4 / GTM don't:
//   1. `attrs.data-domain` — the `data-*` pass-through path through
//      the runtime's attribute allowlist.
//   2. Two admin fields on the same plugin — `domain` and `scriptUrl`.
//   3. A `required: true` URL field with a non-empty default so
//      operators can't accidentally save `src=''` and silently break
//      analytics. To switch back to plausible.io from a self-hosted
//      override, the admin uses "Reset to default".

import { definePlugin, type AmplessPlugin } from 'ampless'

export interface PlausibleOptions {
  /**
   * The Plausible site domain (e.g. `'example.com'`). Must match the
   * value registered in the Plausible dashboard exactly — Plausible
   * uses the string as the row key when ingesting events, so a
   * mismatch silently drops every pageview.
   *
   * Constructor argument seeds the manifest `default`. Empty string
   * disables the plugin (descriptor returns `[]`) — handy for staging
   * or for keeping the dependency wired up before the dashboard is
   * provisioned. New deployments should leave it empty and configure
   * the value from `/admin/plugins`.
   */
  domain?: string
  /**
   * URL of the Plausible script. Defaults to
   * `https://plausible.io/js/script.js` (the hosted version). Override
   * for self-hosted Plausible (e.g.
   * `'https://analytics.example.com/js/script.js'`).
   *
   * The manifest field is `required: true` so admins cannot save an
   * empty value — an empty `src` attribute would silently drop the
   * loader. To switch back to the hosted plausible.io URL after a
   * self-hosted override, use "Reset to default" in the admin form.
   */
  scriptUrl?: string
  /**
   * Optional namespace for this instance. Defaults to `'plausible'`.
   * Set distinct values when registering the plugin twice (e.g. one
   * marketing-site domain + one product-site domain on the same
   * deployment).
   */
  instanceId?: string
  /**
   * Optional consent category. When set, the analytics loader does
   * not run until window.amplessConsent.has(consentCategory) returns
   * true. See @ampless/plugin-cookie-consent and the Consent
   * Convention in https://github.com/heavymoons/ampless/wiki/architecture-08-plugin-architecture.
   */
  consentCategory?: string
}

/** Hosted Plausible script URL. Default `scriptUrl` value, also the
 *  "Reset to default" target when an admin overrides for self-hosted. */
const DEFAULT_SCRIPT_URL = 'https://plausible.io/js/script.js'

/**
 * Factory for the Plausible plugin. Emits a single `<script>`
 * descriptor with `data-domain` set to the configured domain. The
 * plugin is `untrusted` — everything runs in the public Next.js
 * process; no AWS data permissions needed.
 *
 * Both settings are read at request time through `ctx.setting()`,
 * with constructor arguments seeding the manifest defaults.
 */
export default function plausiblePlugin(
  options: PlausibleOptions = {}
): AmplessPlugin {
  const {
    domain = '',
    scriptUrl = DEFAULT_SCRIPT_URL,
    instanceId = 'plausible',
    consentCategory = '',
  } = options
  return definePlugin({
    name: 'plausible',
    packageName: '@ampless/plugin-plausible',
    instanceId,
    displayName: { en: 'Plausible Analytics', ja: 'Plausible Analytics' },
    apiVersion: 1,
    trust_level: 'untrusted',
    capabilities: ['publicHead', 'adminSettings'],
    settings: {
      public: [
        {
          type: 'text',
          key: 'domain',
          label: {
            en: 'Site domain',
            ja: 'サイトドメイン',
          },
          description: {
            en: 'The domain registered in Plausible (e.g. example.com). Leave blank to disable the plugin without removing it from cms.config.',
            ja: 'Plausible 管理画面で登録したドメイン (例: example.com)。空にすると cms.config から削除せずにプラグインを無効化できます。',
          },
          // Accept either empty (disable) or a hostname-like string.
          // Plausible matches on the exact registered domain, so this
          // pattern is mostly a "did you paste in a URL by accident"
          // guard rather than a strict FQDN validator.
          pattern: '^$|^[a-zA-Z0-9.-]+$',
          placeholder: 'example.com',
          default: domain,
        },
        {
          type: 'url',
          key: 'scriptUrl',
          label: {
            en: 'Script URL',
            ja: 'スクリプト URL',
          },
          description: {
            en: 'URL of the Plausible script. Defaults to plausible.io; override for self-hosted Plausible.',
            ja: 'Plausible スクリプトの URL。デフォルトは plausible.io。self-hosted Plausible を使う場合に上書き。',
          },
          // required + non-empty default keeps admins from saving
          // src='' and breaking analytics silently. To switch from a
          // self-hosted URL back to plausible.io, the admin uses
          // "Reset to default" (which deletes the DDB row and lets
          // the resolver fall back to this manifest default).
          required: true,
          allowRelative: false,
          placeholder: DEFAULT_SCRIPT_URL,
          default: scriptUrl,
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
      const resolvedDomain = (ctx.setting<string>('domain') ?? '').trim()
      const resolvedScriptUrl = (ctx.setting<string>('scriptUrl') ?? '').trim()
      // Empty domain → disable flow (admin saved ''). Empty
      // scriptUrl should not be reachable through the normal flow
      // (required: true + non-empty default), but guard anyway in
      // case a malformed constructor default was rejected by the
      // resolver — that's the Phase 2 default validation safety
      // net surfacing here.
      if (!resolvedDomain || !resolvedScriptUrl) return []

      const category = (ctx.setting<string>('consentCategory') ?? '').trim()

      // Non-empty consentCategory → gated mode: replace the external
      // script descriptor with a single inlineScript that defers
      // loading until window.amplessConsent.has(category) is true.
      if (category) {
        return [
          {
            type: 'inlineScript',
            id: `plausible-gated-${instanceId}`,
            strategy: 'afterInteractive',
            body: [
              '(function () {',
              '  var initialized = false',
              '  function init() {',
              '    if (initialized) return',
              '    initialized = true',
              '    var s = document.createElement(\'script\')',
              `    s.src = ${JSON.stringify(resolvedScriptUrl)}`,
              '    s.defer = true',
              `    s.setAttribute('data-domain', ${JSON.stringify(resolvedDomain)})`,
              '    document.head.appendChild(s)',
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
              '        console.warn(\'[ampless:plausible] consentCategory is set but window.amplessConsent never installed. Did you forget to register @ampless/plugin-cookie-consent?\')',
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
          id: `plausible-${instanceId}`,
          src: resolvedScriptUrl,
          // `lazyOnload` keeps analytics off the critical hydration
          // path. The descriptor renderer's `lazyOnload` mapping
          // adds `defer`; we set `defer: true` explicitly too so the
          // intent is clear and so a future strategy change doesn't
          // accidentally drop the defer behaviour.
          strategy: 'lazyOnload',
          defer: true,
          attrs: { 'data-domain': resolvedDomain },
        },
      ]
    },
  })
}
