// @ampless/plugin-mermaid — client-side Mermaid diagram rendering.
//
// Injects a single `publicHead` inline script that scans the public page
// for `<pre><code class="language-mermaid">` blocks and renders each one
// as an SVG diagram via mermaid.js, lazily imported from a CDN only when
// such a block actually exists on the page.
//
// Why `publicHead` + a client script (not a server render): post bodies
// land on the public site as static HTML (RSC / dangerouslySetInnerHTML),
// not client components. A head-injected script can therefore safely
// rewrite the rendered code blocks after the fact. The diagram source is
// authored in the post body (semi-trusted), so mermaid runs with
// `securityLevel: 'strict'` by default.
//
// Coexists with `@ampless/plugin-highlight`: highlight skips
// `code.language-mermaid`, and this plugin replaces the whole `<pre>` with
// a `<div class="ampless-mermaid">`, so registration order is irrelevant.
//
// trust_level: 'untrusted' — no AWS data permissions; everything runs at
// request time in the public Next.js process and then in the browser.

import { definePlugin, type AmplessPlugin, type PublicHeadDescriptor } from 'ampless'

/** Pinned default mermaid version. Floating tags are the user's
 *  supply-chain responsibility (see README). */
const DEFAULT_VERSION = '11.15.0'
const DEFAULT_THEME = 'default'
const DEFAULT_SECURITY_LEVEL = 'strict'

const VERSION_RE = /^[0-9]+(\.[0-9]+){0,2}$/
const THEMES = ['default', 'dark', 'forest', 'neutral', 'base'] as const
const SECURITY_LEVELS = ['strict', 'loose', 'antiscript', 'sandbox'] as const

export type MermaidTheme = (typeof THEMES)[number]
export type MermaidSecurityLevel = (typeof SECURITY_LEVELS)[number]

export interface MermaidPluginOptions {
  /**
   * mermaid version to load from jsDelivr. Must be an exact or partial
   * `x` / `x.y` / `x.y.z` version string. Invalid values fall back to the
   * pinned default with a `console.warn`. Floating major/minor tags are
   * accepted but their supply-chain risk is the site author's
   * responsibility.
   */
  version?: string
  /** mermaid theme. One of default / dark / forest / neutral / base. */
  theme?: MermaidTheme
  /**
   * mermaid `securityLevel`. Default `'strict'`. `'loose'` enables
   * interactivity (click handlers, links) but allows `javascript:` href
   * XSS from the (semi-trusted) diagram source — see README.
   */
  securityLevel?: MermaidSecurityLevel
}

/**
 * Validate / normalize a constructor option against an allowlist before it
 * is embedded into the client script body. Falls back (with a warn) when
 * the supplied value is not in `allowed`.
 */
function pickAllowed<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
  label: string
): T {
  if (value === undefined) return fallback
  if ((allowed as readonly string[]).includes(value)) return value as T
  console.warn(
    `[ampless-mermaid] ignoring invalid ${label} "${value}"; falling back to "${fallback}".`
  )
  return fallback
}

/** Validate a version string; fall back (with a warn) when malformed. */
function pickVersion(value: string | undefined): string {
  if (value === undefined) return DEFAULT_VERSION
  if (VERSION_RE.test(value)) return value
  console.warn(
    `[ampless-mermaid] ignoring invalid version "${value}"; falling back to "${DEFAULT_VERSION}".`
  )
  return DEFAULT_VERSION
}

/**
 * Build the inline script body. All interpolated values are validated /
 * normalized on the Node side first; string literals are embedded via
 * `JSON.stringify` and the version is only ever a `VERSION_RE`-validated
 * string concatenated into the CDN URL.
 */
function buildBody(version: string, theme: string, securityLevel: string): string {
  const SEC = JSON.stringify(securityLevel)
  const THEME = JSON.stringify(theme)
  const SRC = JSON.stringify(
    `https://cdn.jsdelivr.net/npm/mermaid@${version}/dist/mermaid.esm.min.mjs`
  )
  return `(function () {
  var modPromise;
  var counter = 0;
  function scan() {
    var blocks = Array.prototype.slice.call(
      document.querySelectorAll('pre > code.language-mermaid:not([data-ampless-done])')
    );
    if (!blocks.length) return;
    // Mark first so a re-entrant scan (MutationObserver firing while the
    // import resolves) does not double-process the same block.
    blocks.forEach(function (b) { b.setAttribute('data-ampless-done', '1'); });
    if (!modPromise) modPromise = import(${SRC});
    modPromise.then(function (mod) {
      var mermaid = mod.default;
      mermaid.initialize({ startOnLoad: false, securityLevel: ${SEC}, theme: ${THEME} });
      blocks.forEach(function (code) {
        var pre = code.closest('pre');
        var uuid = globalThis.crypto && globalThis.crypto.randomUUID
          ? globalThis.crypto.randomUUID() : undefined;
        var id = uuid ? 'm' + uuid : 'ampless-mmd-' + (counter++);
        Promise.resolve()
          .then(function () { return mermaid.render(id, code.textContent || ''); })
          .then(function (res) {
            var wrap = document.createElement('div');
            wrap.className = 'ampless-mermaid';
            wrap.innerHTML = res.svg;
            (pre || code).replaceWith(wrap);
          })
          .catch(function (e) {
            // Keep the original code visible and allow a later scan to retry.
            code.removeAttribute('data-ampless-done');
            console.warn('[ampless-mermaid] render failed', e);
          });
      });
    }).catch(function (e) {
      // Drop the cached import so a later scan re-attempts the load, and
      // unmark the blocks so they are picked up again.
      modPromise = undefined;
      blocks.forEach(function (b) { b.removeAttribute('data-ampless-done'); });
      console.warn('[ampless-mermaid] load failed', e);
    });
  }
  function init() {
    scan();
    // SPA / App Router client navigation: the head script runs once but new
    // post content arrives later. Re-scan (debounced) when the body mutates.
    if (typeof MutationObserver === 'function') {
      var t;
      var obs = new MutationObserver(function () {
        clearTimeout(t);
        t = setTimeout(scan, 100);
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();`
}

/**
 * Factory for the Mermaid diagram plugin. Usage in `cms.config.ts`:
 *
 * ```ts
 * import { defineConfig } from 'ampless'
 * import mermaidPlugin from '@ampless/plugin-mermaid'
 *
 * export default defineConfig({
 *   plugins: [mermaidPlugin()],
 * })
 * ```
 */
export default function mermaidPlugin(opts: MermaidPluginOptions = {}): AmplessPlugin {
  const version = pickVersion(opts.version)
  const theme = pickAllowed(opts.theme, THEMES, DEFAULT_THEME, 'theme')
  const securityLevel = pickAllowed(
    opts.securityLevel,
    SECURITY_LEVELS,
    DEFAULT_SECURITY_LEVEL,
    'securityLevel'
  )

  const body = buildBody(version, theme, securityLevel)

  return definePlugin({
    name: 'mermaid',
    apiVersion: 1,
    packageName: '@ampless/plugin-mermaid',
    trust_level: 'untrusted',
    capabilities: ['publicHead'],
    displayName: { en: 'Mermaid diagrams', ja: 'Mermaid ダイアグラム' },
    publicHead(): readonly PublicHeadDescriptor[] {
      return [{ type: 'inlineScript', id: 'ampless-mermaid', body }]
    },
  })
}
