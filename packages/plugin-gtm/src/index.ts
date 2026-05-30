// @ampless/plugin-gtm — Google Tag Manager plugin, the second untrusted
// plugin to exercise the Phase 1 descriptor API + Phase 2 admin-managed
// `settings.public`. Unlike GA4 (which only uses `publicHead`), GTM
// needs both `publicHead` (the async loader script) and `publicBodyEnd`
// (the `<noscript>` iframe fallback so consent banners and pageviews
// fire even for visitors with JavaScript disabled).
//
// Both surfaces share the same admin-edited container ID via
// `ctx.setting<string>('containerId')`. Empty container ID disables
// the plugin without removing it from `cms.config.ts` — the renderer
// returns `[]` from both methods and no DOM is emitted.

import { definePlugin, type AmplessPlugin } from 'ampless'

export interface GtmOptions {
  /**
   * Optional fallback Google Tag Manager container ID, e.g.
   * `"GTM-XXXXXXX"`. Used only when no admin-stored value exists in
   * `pk='siteconfig', sk='plugins.<instanceId>.containerId'`. An
   * empty string disables the plugin (both `publicHead` and
   * `publicBodyEnd` return `[]`), which is the recommended way to
   * keep the dependency wired up while toggling GTM off — for
   * example in staging or before consent is granted.
   *
   * New deployments should leave it empty and configure the value
   * from `/admin/plugins`.
   */
  containerId?: string
  /**
   * Optional namespace for this instance. Defaults to `'gtm'`. Set
   * distinct values when registering the plugin twice (e.g. a
   * marketing + a product container on the same site).
   */
  instanceId?: string
}

/**
 * Factory for the GTM plugin. Returns a plugin manifest that emits
 * the GTM loader inline script in `<head>` and the matching
 * `<noscript>` iframe at the end of `<body>`. The plugin is
 * `untrusted` — it does not need any AWS data permissions because
 * everything happens inside the public Next.js process at render
 * time.
 *
 * The container ID is read at request time through
 * `ctx.setting<string>('containerId')`, with the constructor
 * argument seeding the manifest `default` for first-time installs
 * before an admin has saved a value.
 */
export default function gtmPlugin(options: GtmOptions = {}): AmplessPlugin {
  const { containerId = '', instanceId = 'gtm' } = options
  return definePlugin({
    name: 'gtm',
    packageName: '@ampless/plugin-gtm',
    instanceId,
    displayName: { en: 'Google Tag Manager', ja: 'Google Tag Manager' },
    apiVersion: 1,
    trust_level: 'untrusted',
    capabilities: ['publicHead', 'publicBody', 'adminSettings'],
    settings: {
      public: [
        {
          type: 'text',
          key: 'containerId',
          label: {
            en: 'Container ID',
            ja: 'コンテナ ID',
          },
          description: {
            en: 'GTM container ID (e.g. GTM-XXXXXXX). Leave blank to disable the plugin without removing it from cms.config.',
            ja: 'GTM のコンテナ ID (例: GTM-XXXXXXX)。空にすると cms.config から削除せずにプラグインを無効化できます。',
          },
          // Accept either empty (disable) or a well-formed GTM
          // container id. Google's install docs don't publish a
          // strict format, so we keep this loose — empty + the
          // common `GTM-XXXX...` shape is the practical check.
          pattern: '^$|^GTM-[A-Z0-9]+$',
          placeholder: 'GTM-XXXXXXX',
          default: containerId,
        },
      ],
    },
    publicHead(ctx) {
      const id = (ctx.setting<string>('containerId') ?? '').trim()
      // Empty containerId → no descriptors. Lets consumers leave
      // the plugin registered while toggling GTM off without
      // changing the plugin list.
      if (!id) return []
      return [
        {
          type: 'inlineScript',
          id: `gtm-loader-${instanceId}`,
          strategy: 'afterInteractive',
          // GTM's official "Add this code to the <head>" snippet,
          // minified. JSON.stringify the container ID so any
          // accidental quote/control char would stay quoted instead
          // of breaking out of the literal.
          body: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${JSON.stringify(id)});`,
        },
      ]
    },
    publicBodyEnd(ctx) {
      const id = (ctx.setting<string>('containerId') ?? '').trim()
      if (!id) return []
      return [
        {
          type: 'noscript',
          id: `gtm-noscript-${instanceId}`,
          // The matching `<noscript>` iframe fallback. The runtime
          // pipes `html` through `dangerouslySetInnerHTML`, which is
          // safe here because we built the value from a
          // validator-checked container ID + a fixed template.
          html: `<iframe src="https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(id)}" height="0" width="0" style="display:none;visibility:hidden"></iframe>`,
        },
      ]
    },
  })
}
