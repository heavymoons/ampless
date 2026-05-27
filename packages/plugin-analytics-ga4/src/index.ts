// @ampless/plugin-analytics-ga4 — first bundled plugin for the
// descriptor-based head injection API (Phase 1).
//
// Drops the two Google Analytics 4 snippets into `<head>`:
//
//   1. The async loader `<script src="https://www.googletagmanager.com/gtag/js?id=...">`
//   2. The inline init `<script>window.dataLayer = ...; gtag('config', '...')</script>`
//
// The runtime validates both descriptors before rendering (URL scheme
// check on (1), id-required check on (2)).
//
// Phase 1 configures the plugin entirely through constructor args.
// Admin-UI-managed settings, secret storage, and per-instance overrides
// land in later phases — see docs/tmp/plugin-extension-roadmap.md.

import { definePlugin, type AmplessPlugin } from 'ampless'

export interface AnalyticsGa4Options {
  /**
   * Google Analytics 4 measurement ID, e.g. `"G-XXXXXXXX"`. An empty
   * string disables the plugin (descriptors return `[]`), which is
   * the recommended way to keep the dependency wired up while
   * temporarily turning analytics off — for example in staging or
   * before consent is granted.
   */
  measurementId: string
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
  options: AnalyticsGa4Options
): AmplessPlugin {
  const { measurementId, instanceId = 'analytics-ga4' } = options
  return definePlugin({
    name: 'analytics-ga4',
    instanceId,
    displayName: { en: 'Google Analytics 4', ja: 'Google Analytics 4' },
    apiVersion: 1,
    trust_level: 'untrusted',
    capabilities: ['publicHead'],
    publicHead() {
      // Empty measurementId → no descriptors. Lets consumers leave
      // the plugin registered while toggling analytics off without
      // changing the plugin list.
      if (!measurementId) return []
      return [
        {
          type: 'script',
          id: `ga4-loader-${instanceId}`,
          src: `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(
            measurementId
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
            `gtag('config', ${JSON.stringify(measurementId)});`,
          ].join('\n'),
        },
      ]
    },
  })
}
