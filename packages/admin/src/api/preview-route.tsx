import type { Post } from 'ampless'
import { renderThemeCss } from '@ampless/runtime'
import type { Admin } from '../index.js'

// ---------------------------------------------------------------------------
// PREVIEW_BASE_CSS
//
// A self-contained typography stylesheet that approximates
// @tailwindcss/typography (the `prose` utility) for use inside the preview
// iframe. The preview iframe uses `srcDoc` and therefore does NOT inherit
// any CSS from the parent admin page — classes on the iframe *element*
// (e.g. `prose prose-neutral`) only style the element's border-box, not its
// content document.
//
// Goal: "readable preview". We intentionally do NOT attempt pixel-perfect
// parity with the live public site. Next.js App Router emits hashed CSS
// bundles whose filenames are unknown at route-handler time, so we cannot
// reference them from a Route Handler response. The live theme's CSS custom
// properties ARE injected via `renderThemeCss` (the `:root` block above this
// stylesheet), so theme colour tokens will take effect when the theme's own
// CSS already uses them as var(--…). Everything else below is a safe,
// readable fallback.
// ---------------------------------------------------------------------------
const PREVIEW_BASE_CSS = `
/* ampless admin preview — typography approximation */
*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
  font-size: 1rem;
  line-height: 1.75;
  color: #1a202c;
  background: #fff;
  margin: 0;
  padding: 1.5rem;
  max-width: 65ch;
}

main {
  width: 100%;
}

/* Headings */
h1, h2, h3, h4, h5, h6 {
  font-weight: 700;
  line-height: 1.25;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}
h1 { font-size: 2.25em; margin-top: 0; }
h2 { font-size: 1.5em; }
h3 { font-size: 1.25em; }
h4 { font-size: 1em; }
h5 { font-size: 0.875em; }
h6 { font-size: 0.875em; font-weight: 600; color: #4a5568; }

/* Paragraph */
p {
  margin-top: 1em;
  margin-bottom: 1em;
}

/* Lists */
ul, ol {
  padding-left: 1.625em;
  margin-top: 1em;
  margin-bottom: 1em;
}
ul { list-style-type: disc; }
ol { list-style-type: decimal; }
li {
  margin-top: 0.25em;
  margin-bottom: 0.25em;
}
li > ul, li > ol {
  margin-top: 0.25em;
  margin-bottom: 0.25em;
}

/* Links */
a {
  color: #2563eb;
  text-decoration: underline;
}
a:hover {
  color: #1d4ed8;
}

/* Inline code */
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  font-size: 0.875em;
  background: #f1f5f9;
  padding: 0.125em 0.375em;
  border-radius: 0.25em;
}

/* Code block */
pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  font-size: 0.875em;
  background: #1e293b;
  color: #e2e8f0;
  padding: 1em 1.25em;
  border-radius: 0.5em;
  overflow-x: auto;
  margin-top: 1.25em;
  margin-bottom: 1.25em;
  line-height: 1.7;
}
pre code {
  background: transparent;
  padding: 0;
  font-size: inherit;
  color: inherit;
  border-radius: 0;
}

/* Blockquote */
blockquote {
  border-left: 0.25rem solid #cbd5e1;
  padding-left: 1em;
  margin-left: 0;
  margin-right: 0;
  color: #64748b;
  font-style: italic;
}

/* Horizontal rule */
hr {
  border: none;
  border-top: 1px solid #e2e8f0;
  margin: 2em 0;
}

/* Images */
img {
  max-width: 100%;
  height: auto;
  border-radius: 0.375em;
}

/* Tables */
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875em;
  margin-top: 1.25em;
  margin-bottom: 1.25em;
}
th {
  font-weight: 600;
  text-align: left;
  padding: 0.5em 0.75em;
  border-bottom: 2px solid #e2e8f0;
}
td {
  padding: 0.5em 0.75em;
  border-bottom: 1px solid #e2e8f0;
}
tr:last-child td {
  border-bottom: none;
}

/* Strong / em */
strong { font-weight: 700; }
em { font-style: italic; }

/* ------------------------------------------------------------------ */
/* Dark mode                                                           */
/* ------------------------------------------------------------------ */
@media (prefers-color-scheme: dark) {
  body {
    color: #e2e8f0;
    background: #0f172a;
  }
  h6 { color: #94a3b8; }
  a { color: #60a5fa; }
  a:hover { color: #93c5fd; }
  code { background: #1e293b; color: #e2e8f0; }
  pre { background: #0f172a; border: 1px solid #334155; color: #e2e8f0; }
  blockquote { border-left-color: #475569; color: #94a3b8; }
  hr { border-top-color: #334155; }
  th { border-bottom-color: #334155; }
  td { border-bottom-color: #1e293b; }
}
`.trim()

/**
 * Build the `POST /admin/preview` Route Handler.
 *
 * Client-side `<PostForm>` / `<PostHistoryPanel>` POST a draft Post to this
 * endpoint while the preview tab is open; we render the body + page-level
 * scripts via `ampless.renderBody` / `publicPostScriptsForPage` and return
 * a **complete HTML document** that the admin shows in an iframe using
 * `srcDoc`.
 *
 * ## Why a complete document (not a bare fragment)?
 *
 * An iframe loaded via `srcDoc` does NOT inherit the parent page's CSS.
 * Classes on the iframe *element* (e.g. `prose prose-neutral`) style only
 * the element's box model, not its content document. To get typography inside
 * the preview we must inline the styles directly into the document we return.
 * We inject two `<style>` blocks:
 *
 *   1. **Theme CSS vars**: `renderThemeCss(cssVars)` — the same `:root {…}`
 *      block the public root layout emits, so the live theme's colour tokens
 *      flow into the preview.
 *   2. **`PREVIEW_BASE_CSS`** (`id="ampless-preview-base"`): a self-contained
 *      typography approximation (h1-h6, p, ul/ol/li, a, code, pre, blockquote,
 *      img, table, hr, dark mode). This is *not* the actual live theme stylesheet
 *      — Next.js App Router emits hashed CSS filenames that are unknowable from
 *      a Route Handler — but it's enough for a "readable preview" when the
 *      client-side injection has no stylesheets to collect.
 *
 * ## Two-stage design: client injection primary, base CSS fallback
 *
 * Before the iframe's srcDoc is set, the client helper `buildPreviewSrcDoc`
 * (packages/admin/src/lib/preview-srcdoc.ts) collects the parent admin page's
 * actual compiled stylesheets (`link[rel="stylesheet"]` absolute hrefs and
 * inline `<style>` blocks) and injects them right after `<head>` in the
 * document returned here. When ≥ 1 stylesheet is collected the fallback
 * `<style id="ampless-preview-base">` block is stripped (it would compete with
 * the real theme CSS). When 0 are collected (e.g. SSR path or no stylesheets
 * yet), the fallback is kept so the preview stays readable.
 *
 * This gives pixel-accurate theme rendering (drop caps, theme tokens, dark
 * mode) in the preview without requiring the Route Handler to know the hashed
 * CSS bundle filenames.
 *
 * ## Why a Route Handler (not a Server Action)?
 *
 * Next.js 15+ refuses to compile Client Components that reach
 * `react-dom/server` through a `'use server'` module, because the build
 * traces the import graph from Client Components through Server Action
 * modules. Putting this rendering behind a Route Handler decouples it from
 * that graph entirely — the form fetches a plain HTTP endpoint and the
 * bundler never walks from `<PostForm>` into here. The endpoint also gets an
 * explicit `admin.isEditor()` gate so a future change to the `(admin)`
 * route-group middleware can't silently turn preview into a content-leak
 * vector for unpublished drafts.
 *
 * ## Dynamic import of `react-dom/server`
 *
 * The `react-dom/server` import itself is loaded via dynamic `import()` inside
 * the handler. Next.js 16's Turbopack flags any top-level static
 * `import 'react-dom/server'` reached from the app router build (Route
 * Handlers included), so we deliberately defer the resolution to request time
 * — the module is still pulled from the same Node.js subpath that `next start`
 * ships, just not visible to the build-time import-graph walker.
 *
 * ## Auth
 *
 * Locked to authenticated editors. Anonymous + reader access is 403. This
 * matches the rest of `/admin/**`, which is gated by the `(admin)` route
 * group + middleware, but we add an explicit check here as defence-in-depth
 * against the middleware gate being misconfigured.
 */
export interface PreviewRouteHandlerOptions {
  /**
   * CSS class string applied to the `<main>` wrapper in the preview document.
   * Defaults to `'prose prose-neutral dark:prose-invert max-w-none'` which
   * matches the typical blog theme `#post-body` wrapper. Sites that use a
   * different wrapper class (e.g. a custom typography plugin) can override
   * this so the theme's `.prose`-scoped CSS selectors apply correctly inside
   * the preview iframe.
   */
  bodyClassName?: string
}

export function createPreviewRouteHandler(
  admin: Admin,
  options: PreviewRouteHandlerOptions = {}
): (req: Request) => Promise<Response> {
  const {
    bodyClassName = 'prose prose-neutral dark:prose-invert max-w-none',
  } = options
  return async function POST(req: Request): Promise<Response> {
    const session = await admin.getServerSession()
    if (!admin.isEditor(session)) {
      return new Response('Forbidden', { status: 403 })
    }
    let draft: Post
    try {
      draft = (await req.json()) as Post
    } catch {
      return new Response('Bad Request', { status: 400 })
    }
    const ampless = await admin.getAmpless()
    // IMPORTANT: include BOTH the body and the page-level scripts so
    // widgets like x.com's `widgets.js` get a chance to hydrate in the
    // iframe.
    const node = (
      <>
        {await ampless.renderBody(draft)}
        {await ampless.publicPostScriptsForPage([draft])}
      </>
    )
    // Collect plugin publicHead for the preview <head>. Uses the non-gated
    // renderHeadForPreview so content-decoration plugins (mermaid, highlight)
    // are included even though this is an admin route (isPublicRequest() would
    // otherwise return null and suppress them).
    const headNode = await ampless.publicHeadForPreview()
    // Dynamic import: see factory TSDoc. The module is server-only and
    // resolved at request time to avoid Turbopack's static-import-graph check.
    const { renderToStaticMarkup } = await import('react-dom/server')
    const fragment = renderToStaticMarkup(node)
    const headMarkup = headNode ? renderToStaticMarkup(<>{headNode}</>) : ''

    // Resolve theme CSS vars for the preview document. Falls back to an empty
    // object on error (no vars = preview still works, just without theme
    // colour tokens). We catch here because `loadThemeConfig` reaches the S3
    // site-settings cache — if storage isn't configured yet (e.g. first-run
    // sandbox), we shouldn't break preview entirely.
    let themeCssBlock = ''
    try {
      const themeConfig = await admin.loadThemeConfig()
      const css = renderThemeCss(themeConfig.cssVars)
      if (css) themeCssBlock = css
    } catch (err) {
      // Storage not yet configured or theme manifest unavailable — skip vars.
      // Recoverable, but leave a log trail (repo guidance: never swallow
      // server-side errors silently) so an S3 / theme-cache misconfig is
      // debuggable instead of just rendering an unthemed preview.
      console.warn('[ampless admin] preview theme CSS unavailable:', err)
    }

    const html =
      `<!doctype html>` +
      `<html>` +
      `<head>` +
      `<meta charset="utf-8">` +
      (themeCssBlock ? `<style>${themeCssBlock}</style>` : '') +
      `<style id="ampless-preview-base">${PREVIEW_BASE_CSS}</style>` +
      headMarkup +
      `</head>` +
      `<body class="ampless-preview">` +
      `<main class="${bodyClassName}">${fragment}</main>` +
      `</body>` +
      `</html>`

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  }
}
