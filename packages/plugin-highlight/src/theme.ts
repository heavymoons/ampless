// Internal theme-resolution helper for @ampless/plugin-highlight.
//
// NOT re-exported from index.ts — this is a test-only / internal API, so it
// stays off the package's public surface. The same logic is mirrored inline
// in the client script body (`buildBody`); this module exists so the pure
// decision can be unit-tested directly.

/** Compose the jsDelivr stylesheet URL for a highlight.js theme name. */
function hrefFor(theme: string, version: string): string {
  return `https://cdn.jsdelivr.net/npm/highlight.js@${version}/styles/${theme}.min.css`
}

/**
 * Resolve the highlight.js stylesheet href to load.
 *
 * The configured value is the (already validated) `theme` option. When it is
 * the sentinel `'auto'` the stylesheet follows the site's color scheme:
 * `github-dark` for a dark scheme, `github` otherwise. Any explicit theme
 * pins it regardless of `isDark`. The `version` is the validated version
 * string concatenated into the CDN URL.
 */
export function chooseHighlightHref(configured: string, isDark: boolean, version: string): string {
  if (configured === 'auto') {
    return hrefFor(isDark ? 'github-dark' : 'github', version)
  }
  return hrefFor(configured, version)
}
