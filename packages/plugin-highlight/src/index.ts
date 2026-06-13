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
const DEFAULT_THEME = 'github'

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
   * `'github-dark'`, `'atom-one-dark'`). Must match
   * `/^[a-z0-9][a-z0-9-]{0,40}$/`; invalid values fall back to
   * `'github'` with a `console.warn`. The corresponding
   * `styles/<theme>.min.css` is loaded from the CDN.
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

/** Validate a theme name; fall back (with a warn) when malformed. */
function pickTheme(value: string | undefined): string {
  if (value === undefined) return DEFAULT_THEME
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
  const CSS = JSON.stringify(
    `https://cdn.jsdelivr.net/npm/highlight.js@${version}/styles/${theme}.min.css`
  )
  const SRC = JSON.stringify(`https://cdn.jsdelivr.net/npm/highlight.js@${version}/+esm`)
  return `(function () {
  var modPromise;
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
      link.href = ${CSS};
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
