// Shared request-header name constants used across the runtime.
// String literals are centralised here to prevent typos and make
// renames safe — every runtime consumer imports from this module
// rather than hard-coding the header name.

/** Set by the ampless middleware on every request it handles (public routes only).
 *  Value = `url.pathname` of the incoming request.  Server components
 *  that should render only on public pages — e.g. `renderHead` /
 *  `renderBodyEnd` — read this header to confirm the middleware ran.
 *  Because the middleware's `matcher` excludes `/admin`, `/api`, and
 *  `/login`, the runtime does not set this marker on those routes.
 *  Middleware overwrites spoofed incoming values with `set` on public
 *  routes it does handle; admin/login requests never pass through this
 *  code path.
 */
export const AMPLESS_PATHNAME_HEADER = 'x-ampless-pathname'

/** Forwarded by the middleware when `?previewTheme=<name>` is present.
 *  Used by `resolveActiveTheme` to show an unsaved theme in the admin
 *  iframe-based theme preview without persisting the choice.
 */
export const PREVIEW_THEME_HEADER = 'x-preview-theme'

/** Forwarded by the middleware when `?previewColorScheme=<value>` is present.
 *  Companion to `PREVIEW_THEME_HEADER` for the admin theme-preview iframe.
 */
export const PREVIEW_COLOR_SCHEME_HEADER = 'x-preview-color-scheme'
