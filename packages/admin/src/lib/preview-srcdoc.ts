/**
 * Client-only helper that rewrites the preview-route HTML document so the
 * iframe renders with the SAME stylesheets as the parent admin page (= the
 * site's real compiled CSS, including theme tokens like drop caps).
 *
 * The `createPreviewRouteHandler` factory in `packages/admin/src/api/preview-route.tsx`
 * returns a minimal HTML document with a `<style id="ampless-preview-base">`
 * typography fallback. This helper:
 *
 *   1. Collects the parent document's real stylesheets:
 *      - `link[rel="stylesheet"]` hrefs (absolute-ified, for prod/Next hashed bundles)
 *      - inline `<style>` element contents (for Next.js dev/HMR style-tag injection)
 *   2. Injects the collected `<link>`/`<style>` tags right after `<head>` in the
 *      server-returned HTML.
 *   3. Copies ALL `data-*` attributes from `document.body` onto the iframe `<body`
 *      tag so theme tokens scoped as `body[data-theme="..."] .prose > ...` apply.
 *   4. Copies `document.documentElement.className` onto the `<html` tag for
 *      Tailwind class-strategy dark mode (`dark` class on `<html>`).
 *   5. When ≥ 1 stylesheet was collected, strips the server's fallback
 *      `<style id="ampless-preview-base">...</style>` block so the approximation
 *      CSS doesn't compete with the real theme styles. When 0 are collected the
 *      fallback is preserved (= same behaviour as before this helper was added).
 *
 * Must only be called in a browser environment. Returns the input string
 * unchanged when:
 *   - `typeof document === 'undefined'` (SSR / test without jsdom)
 *   - The input has no `<head>` tag (defensive: malformed server response)
 */
export function buildPreviewSrcDoc(html: string): string {
  // SSR guard — never run DOM queries on the server.
  if (typeof document === 'undefined') return html

  // Defensive guard: if the server returned something unexpected, pass through.
  if (!html.includes('<head>')) return html

  // ------------------------------------------------------------------
  // 1. Collect parent document stylesheets
  // ------------------------------------------------------------------

  const linkTags: string[] = []
  const styleTags: string[] = []

  // link[rel="stylesheet"] → absolutise href, emit a <link> tag
  const linkEls = document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
  for (const el of linkEls) {
    // el.href is already absolute (browser resolves it against document.baseURI)
    if (el.href) {
      linkTags.push(`<link rel="stylesheet" href="${el.href}">`)
    }
  }

  // inline <style> elements → copy textContent
  const styleEls = document.querySelectorAll<HTMLStyleElement>('style')
  for (const el of styleEls) {
    const content = el.textContent ?? ''
    if (content.trim()) {
      styleTags.push(`<style>${content}</style>`)
    }
  }

  const collected = [...linkTags, ...styleTags]

  // ------------------------------------------------------------------
  // 2. Inject collected stylesheets after <head>
  // ------------------------------------------------------------------
  let result = html

  if (collected.length > 0) {
    result = result.replace('<head>', `<head>${collected.join('')}`)
  }

  // ------------------------------------------------------------------
  // 3. Copy parent body data-* attributes onto the iframe <body tag
  // ------------------------------------------------------------------

  const bodyDataAttrs: string[] = []
  for (const attr of document.body.attributes) {
    if (attr.name.startsWith('data-')) {
      // Escape double-quotes in attribute values to avoid breaking the tag
      const escaped = attr.value.replace(/"/g, '&quot;')
      bodyDataAttrs.push(`${attr.name}="${escaped}"`)
    }
  }

  if (bodyDataAttrs.length > 0) {
    // The factory emits `<body class="ampless-preview">` — insert data-*
    // attributes before the closing `>` of the opening body tag.
    result = result.replace(
      /(<body\b[^>]*)(>)/,
      `$1 ${bodyDataAttrs.join(' ')}$2`
    )
  }

  // ------------------------------------------------------------------
  // 4. Copy parent html element className onto the iframe <html tag
  // ------------------------------------------------------------------

  const htmlClass = document.documentElement.className
  if (htmlClass) {
    const escaped = htmlClass.replace(/"/g, '&quot;')
    // The factory emits `<html>` — replace with `<html class="...">`.
    // If the tag already has a class attribute (should not happen with the
    // current factory but defensive), append rather than duplicate.
    result = result.replace(
      /(<html\b)([^>]*)(>)/,
      (_, open, attrs, close) => {
        if (/class=/.test(attrs)) {
          // Append to existing class attribute
          return `${open}${attrs.replace(/class="([^"]*)"/, `class="$1 ${escaped}`)}${close}`
        }
        return `${open}${attrs} class="${escaped}"${close}`
      }
    )
  }

  // ------------------------------------------------------------------
  // 5. Strip the server fallback when real stylesheets were collected
  // ------------------------------------------------------------------

  if (collected.length > 0) {
    // Remove the entire <style id="ampless-preview-base">...</style> block.
    // The factory emits this as a single unbroken tag with no newlines in the
    // tag itself, so a non-greedy regex is safe.
    result = result.replace(/<style\s+id="ampless-preview-base">[\s\S]*?<\/style>/, '')
  }

  return result
}
