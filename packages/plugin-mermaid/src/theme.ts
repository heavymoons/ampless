// Internal theme-resolution helper for @ampless/plugin-mermaid.
//
// NOT re-exported from index.ts — this is a test-only / internal API, so it
// stays off the package's public surface. The same logic is mirrored inline
// in the client script body (`buildBody`); this module exists so the pure
// decision can be unit-tested directly.

/**
 * Resolve the mermaid theme to render with.
 *
 * The configured value is the (already validated) `theme` option. When it is
 * the sentinel `'auto'` the theme follows the site's color scheme: `'dark'`
 * for a dark scheme, `'default'` (mermaid's light theme) otherwise. Any
 * explicit theme pins it regardless of `isDark`.
 */
export function chooseMermaidTheme(configured: string, isDark: boolean): string {
  if (configured !== 'auto') return configured
  return isDark ? 'dark' : 'default'
}
