// @ampless/plugin-highlight — client-side syntax highlighting.
//
// Injects a single `publicHead` inline script that scans the public page
// for `<pre><code class="language-xxx">` blocks (excluding
// `language-mermaid`) and highlights each one with highlight.js, lazily
// imported from a CDN only when such a block actually exists on the page.
// The theme stylesheet is injected once, on demand, from the same CDN.
//
// Why `publicHead` + a client script (not a server render): post bodies
// land on the public site as static HTML (RSC / dangerouslySetInnerHTML),
// not client components. A head-injected script can therefore safely
// decorate the rendered code blocks after the fact.
//
// Coexists with `@ampless/plugin-mermaid`: this plugin explicitly skips
// `code.language-mermaid` so mermaid keeps its diagram source, and guards
// already-highlighted blocks with `:not(.hljs)`. Registration order is
// irrelevant.
//
// trust_level: 'untrusted' — no AWS data permissions; everything runs at
// request time in the public Next.js process and then in the browser.

import { definePlugin, type AmplessPlugin, type PublicHeadDescriptor } from 'ampless'

/** Pinned default highlight.js version. Floating tags are the user's
 *  supply-chain responsibility (see README). */
const DEFAULT_VERSION = '11.11.1'
const DEFAULT_THEME = 'auto'

const VERSION_RE = /^[0-9]+(\.[0-9]+){0,2}$/
const THEME_RE = /^[a-z0-9][a-z0-9-]{0,40}$/

export interface HighlightPluginOptions {
  /**
   * highlight.js version to load from jsDelivr. Must be an exact or
   * partial `x` / `x.y` / `x.y.z` version string. Invalid values fall
   * back to the pinned default with a `console.warn`. Floating
   * major/minor tags are accepted but their supply-chain risk is the
   * site author's responsibility.
   */
  version?: string
  /**
   * highlight.js stylesheet theme name (e.g. `'github'`,
   * `'github-dark'`, `'atom-one-dark'`), or the sentinel `'auto'`.
   * Default `'auto'`.
   *
   * `'auto'` (the default) adapts to the site's color scheme at runtime:
   * it loads `github-dark` on a dark scheme and `github` otherwise, and
   * live-swaps the stylesheet when the scheme changes. The scheme is read
   * from the `<html data-color-scheme>` attribute (`'light'` / `'dark'`);
   * when the attribute is absent (site setting `auto`) it follows the OS
   * `prefers-color-scheme`. Any explicit theme pins that stylesheet
   * regardless of the site scheme. Explicit names must match
   * `/^[a-z0-9][a-z0-9-]{0,40}$/`; invalid values fall back to `'auto'`
   * with a `console.warn`. The corresponding `styles/<theme>.min.css` is
   * loaded from the CDN.
   */
  theme?: string
}

/** Validate a version string; fall back (with a warn) when malformed. */
function pickVersion(value: string | undefined): string {
  if (value === undefined) return DEFAULT_VERSION
  if (VERSION_RE.test(value)) return value
  console.warn(
    `[ampless-highlight] ignoring invalid version "${value}"; falling back to "${DEFAULT_VERSION}".`
  )
  return DEFAULT_VERSION
}

/**
 * Validate a theme name; fall back (with a warn) when malformed. The
 * sentinel `'auto'` is accepted but is not a CSS filename — the client
 * script resolves it to `github` / `github-dark` at runtime per the active
 * color scheme.
 */
function pickTheme(value: string | undefined): string {
  if (value === undefined) return DEFAULT_THEME
  if (value === 'auto') return 'auto'
  if (THEME_RE.test(value)) return value
  console.warn(
    `[ampless-highlight] ignoring invalid theme "${value}"; falling back to "${DEFAULT_THEME}".`
  )
  return DEFAULT_THEME
}

/**
 * Build the inline script body. The version and theme are validated /
 * normalized on the Node side first; only the validated strings are
 * concatenated into the CDN URLs and embedded via `JSON.stringify`.
 */
function buildBody(version: string, theme: string): string {
  const CONFIGURED = JSON.stringify(theme)
  const CSS_PREFIX = JSON.stringify(`https://cdn.jsdelivr.net/npm/highlight.js@${version}/styles/`)
  const SRC = JSON.stringify(`https://cdn.jsdelivr.net/npm/highlight.js@${version}/+esm`)
  return `(function () {
  var configured = ${CONFIGURED};
  var modPromise;
  // Serializes theme swaps: the <link> we are mid-loading and the href we
  // are loading towards. Prevents duplicate id / wrong-theme races when the
  // scheme flips several times before a stylesheet finishes loading.
  var pendingLink;
  var pendingHref;
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
  // Mirror of chooseHighlightHref (src/theme.ts): explicit theme pins;
  // 'auto' maps dark->github-dark / light->github.
  function themeHref() {
    var name = configured === 'auto' ? (isDark() ? 'github-dark' : 'github') : configured;
    return ${CSS_PREFIX} + name + '.min.css';
  }
  function scan() {
    var blocks = Array.prototype.slice.call(
      document.querySelectorAll('pre > code[class*="language-"]:not(.language-mermaid):not(.hljs)')
    );
    if (!blocks.length) return;
    // Inject the theme stylesheet once, only when something needs it.
    if (!document.getElementById('ampless-hljs-theme')) {
      var link = document.createElement('link');
      link.id = 'ampless-hljs-theme';
      link.rel = 'stylesheet';
      link.href = themeHref();
      document.head.appendChild(link);
    }
    if (!modPromise) modPromise = import(${SRC});
    modPromise.then(function (mod) {
      var hljs = mod.default;
      blocks.forEach(function (code) {
        // Guard again at apply time — a concurrent scan may have already
        // highlighted this block.
        if (!code.classList.contains('hljs')) hljs.highlightElement(code);
      });
    }).catch(function (e) {
      // Drop the cached import so a later scan re-attempts the load.
      modPromise = undefined;
      console.warn('[ampless-highlight] load failed', e);
    });
  }
  // Swap the active theme stylesheet to match the current scheme. The hljs
  // classes stay on the blocks, so swapping the <link> re-colors them with
  // no re-highlight. FOUC-safe (add new <link>, swap on load) and race-safe
  // (serialized via pendingLink/pendingHref).
  function swapTheme() {
    var active = document.getElementById('ampless-hljs-theme');
    // No code-block page: nothing to swap. A later scan() injects fresh.
    if (!active) return;
    var desired = themeHref();
    // Already on the right theme, or already loading towards it.
    if (active.href === desired || pendingHref === desired) return;
    // A different swap is in flight: drop its stale <link> before starting
    // a new one (avoids two id-less links racing to claim the id).
    if (pendingLink) {
      if (pendingLink.parentNode) pendingLink.parentNode.removeChild(pendingLink);
      pendingLink = undefined;
      pendingHref = undefined;
    }
    // Add the new stylesheet WITHOUT the id (avoids a transient duplicate id)
    // and only promote it once it has loaded, so the old theme stays applied
    // until the new one is ready (no flash of unstyled code).
    var newLink = document.createElement('link');
    newLink.rel = 'stylesheet';
    newLink.href = desired;
    newLink.onload = function () {
      // Re-check: the scheme may have flipped again while loading.
      if (newLink.href === themeHref()) {
        var old = document.getElementById('ampless-hljs-theme');
        if (old && old !== newLink && old.parentNode) old.parentNode.removeChild(old);
        newLink.id = 'ampless-hljs-theme';
        pendingLink = undefined;
        pendingHref = undefined;
      } else {
        // Stale: keep the old (id-bearing) link, drop this one, re-kick.
        if (newLink.parentNode) newLink.parentNode.removeChild(newLink);
        pendingLink = undefined;
        pendingHref = undefined;
        swapTheme();
      }
    };
    newLink.onerror = function (e) {
      if (newLink.parentNode) newLink.parentNode.removeChild(newLink);
      pendingLink = undefined;
      pendingHref = undefined;
      console.warn('[ampless-highlight] theme stylesheet load failed', e);
    };
    pendingLink = newLink;
    pendingHref = desired;
    document.head.appendChild(newLink);
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
      // (body childList mutations never reflect this) and swap the theme.
      var schemeObs = new MutationObserver(function () { swapTheme(); });
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
        swapTheme();
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
 * Factory for the syntax-highlighting plugin. Usage in `cms.config.ts`:
 *
 * ```ts
 * import { defineConfig } from 'ampless'
 * import highlightPlugin from '@ampless/plugin-highlight'
 *
 * export default defineConfig({
 *   plugins: [highlightPlugin()],
 * })
 * ```
 */
export default function highlightPlugin(opts: HighlightPluginOptions = {}): AmplessPlugin {
  const version = pickVersion(opts.version)
  const theme = pickTheme(opts.theme)

  const body = buildBody(version, theme)

  return definePlugin({
    name: 'highlight',
    apiVersion: 1,
    packageName: '@ampless/plugin-highlight',
    trust_level: 'untrusted',
    capabilities: ['publicHead'],
    displayName: { en: 'Syntax highlighting', ja: 'シンタックスハイライト' },
    publicHead(): readonly PublicHeadDescriptor[] {
      return [{ type: 'inlineScript', id: 'ampless-highlight', body }]
    },
  })
}
