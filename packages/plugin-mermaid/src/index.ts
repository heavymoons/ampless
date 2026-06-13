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
const DEFAULT_THEME = 'auto'
const DEFAULT_SECURITY_LEVEL = 'strict'

const VERSION_RE = /^[0-9]+(\.[0-9]+){0,2}$/
const THEMES = ['auto', 'default', 'dark', 'forest', 'neutral', 'base'] as const
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
  /**
   * mermaid theme. One of `auto` / `default` / `dark` / `forest` /
   * `neutral` / `base`. Default `'auto'`.
   *
   * `'auto'` (the default) adapts to the site's color scheme at runtime:
   * it renders with `'dark'` on a dark scheme and `'default'` (mermaid's
   * light theme) otherwise, and live-re-renders when the scheme changes.
   * The scheme is read from the `<html data-color-scheme>` attribute
   * (`'light'` / `'dark'`); when the attribute is absent (site setting
   * `auto`) it follows the OS `prefers-color-scheme`. Any explicit theme
   * pins that theme regardless of the site scheme.
   */
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
  const CONFIGURED = JSON.stringify(theme)
  const SRC = JSON.stringify(
    `https://cdn.jsdelivr.net/npm/mermaid@${version}/dist/mermaid.esm.min.mjs`
  )
  return `(function () {
  var configured = ${CONFIGURED};
  var modPromise;
  var counter = 0;
  // Which theme the (singleton) mermaid library was last initialized with —
  // not the per-SVG render state. Each rendered wrap remembers its own theme
  // via the data-mermaid-theme attribute.
  var initedTheme;
  // Resolve the active color scheme: explicit data-color-scheme wins;
  // otherwise follow the OS preference, guarded so a missing matchMedia
  // (older / non-browser environments) just means "light".
  function isDark() {
    var attr = document.documentElement.getAttribute('data-color-scheme');
    if (attr === 'dark') return true;
    if (attr === 'light') return false;
    return typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false;
  }
  // Mirror of chooseMermaidTheme (src/theme.ts): explicit theme pins;
  // 'auto' maps dark->'dark' / light->'default'.
  function effectiveTheme() {
    return configured === 'auto' ? (isDark() ? 'dark' : 'default') : configured;
  }
  function ensureMermaidTheme(mermaid, t) {
    if (initedTheme !== t) {
      mermaid.initialize({ startOnLoad: false, securityLevel: ${SEC}, theme: t });
      initedTheme = t;
    }
  }
  function freshId() {
    var uuid = globalThis.crypto && globalThis.crypto.randomUUID
      ? globalThis.crypto.randomUUID() : undefined;
    return uuid ? 'm' + uuid : 'ampless-mmd-' + (counter++);
  }
  // Initial pass: turn each <pre><code class="language-mermaid"> into a
  // rendered <div class="ampless-mermaid"> carrying its source + theme.
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
      ensureMermaidTheme(mermaid, effectiveTheme());
      blocks.forEach(function (code) {
        var pre = code.closest('pre');
        var src = code.textContent || '';
        var t = effectiveTheme();
        var id = freshId();
        Promise.resolve()
          .then(function () { return mermaid.render(id, src); })
          .then(function (res) {
            if (effectiveTheme() !== t) {
              // Stale: the scheme changed mid-render. Discard this SVG and
              // re-run scan() — the block is still a <pre><code>, so
              // rerenderAll() (which only sees div.ampless-mermaid) cannot
              // pick it up. Unmark so scan() processes it again.
              code.removeAttribute('data-ampless-done');
              scan();
              return;
            }
            var wrap = document.createElement('div');
            wrap.className = 'ampless-mermaid';
            wrap.innerHTML = res.svg;
            wrap.setAttribute('data-mermaid-src', src);
            wrap.setAttribute('data-mermaid-theme', t);
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
  // Re-render already-rendered diagrams whose baked-in theme no longer
  // matches the active scheme (mermaid bakes the theme into the SVG, so it
  // cannot be re-tinted — only re-rendered from the saved source).
  function rerenderAll() {
    var theme = effectiveTheme();
    var wraps = Array.prototype.slice
      .call(document.querySelectorAll('div.ampless-mermaid[data-mermaid-src]'))
      .filter(function (w) { return w.getAttribute('data-mermaid-theme') !== theme; });
    // No stale diagram on this page -> do NOT import mermaid (preserves the
    // "no Mermaid block -> never download the library" property).
    if (!wraps.length) return;
    if (!modPromise) modPromise = import(${SRC});
    modPromise.then(function (mod) {
      var mermaid = mod.default;
      var t = effectiveTheme();
      ensureMermaidTheme(mermaid, t);
      wraps.forEach(function (wrap) {
        var id = freshId();
        var src = wrap.getAttribute('data-mermaid-src') || '';
        Promise.resolve()
          .then(function () { return mermaid.render(id, src); })
          .then(function (res) {
            if (effectiveTheme() !== t) {
              // Stale: leave the old SVG + old data-mermaid-theme in place
              // (so it is still seen as out-of-date) and re-kick rerenderAll
              // to converge on the current theme.
              rerenderAll();
              return;
            }
            wrap.innerHTML = res.svg;
            wrap.setAttribute('data-mermaid-theme', t);
          })
          .catch(function (e) {
            // Leave old SVG + old data-mermaid-theme so the next scheme
            // change re-attempts this wrap (its theme still won't match).
            console.warn('[ampless-mermaid] re-render failed', e);
          });
      });
    }).catch(function (e) {
      modPromise = undefined;
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
      // In-site theme toggle: watch the <html> data-color-scheme attribute
      // (body childList mutations never reflect this) and re-render.
      var schemeObs = new MutationObserver(function () { rerenderAll(); });
      schemeObs.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-color-scheme'],
      });
    }
    // OS scheme change in 'auto' mode (site setting 'auto' -> no attribute).
    // No-op while data-color-scheme pins the scheme; fires once the attribute
    // is removed (fixed -> auto) so the OS preference takes over again.
    if (configured === 'auto' && typeof window.matchMedia === 'function') {
      var mql = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () {
        if (document.documentElement.getAttribute('data-color-scheme')) return;
        rerenderAll();
      };
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', onChange);
      } else if (typeof mql.addListener === 'function') {
        mql.addListener(onChange); // Safari < 14
      }
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
