---
"@ampless/admin": minor
---

**Admin preview now renders with the site's real CSS** (theme tokens, drop caps, dark mode).

PR #277 introduced a `PREVIEW_BASE_CSS` approximation because Next.js App Router hashed CSS bundles are unknowable from a Route Handler. However, the admin page itself already loads the site's compiled CSS, so the fix is client-side: collect the parent document's stylesheets and inject them into the preview iframe `srcDoc`.

### What changed

- **New `buildPreviewSrcDoc(html)` helper** (`@ampless/admin/lib/preview-srcdoc`) collects the parent admin page's `link[rel="stylesheet"]` hrefs (absolute-ified, for prod / Next hashed bundles) and inline `<style>` contents (for Next.js dev / HMR injection), then:
  1. Injects them right after `<head>` in the server-returned preview HTML.
  2. Copies ALL `document.body` `data-*` attributes onto the iframe `<body` tag so selectors like `body[data-theme="my-blog"] .prose > p:first-of-type::first-letter` take effect.
  3. Copies `document.documentElement.className` onto the iframe `<html` tag (Tailwind class-strategy dark mode).
  4. Strips the server's `<style id="ampless-preview-base">` fallback when ≥ 1 real stylesheet was collected.
- **`createPreviewRouteHandler` factory** gained an optional `bodyClassName` option (default `'prose prose-neutral dark:prose-invert max-w-none'`) applied to the `<main>` wrapper so the theme's `.prose`-scoped selectors apply. Sites using a different typography wrapper can pass `{ bodyClassName: '...' }`.
- **Two-stage design**: client injection is the primary path (pixel-accurate theme rendering); `PREVIEW_BASE_CSS` (now marked `id="ampless-preview-base"`) is the fallback when 0 stylesheets are collected (e.g. unit tests or unusual browser environments).
- `PostForm` and `PostHistoryPanel` both pipe fetched preview HTML through `buildPreviewSrcDoc` before setting `previewHtml`.

### Backward compatibility

- `createPreviewRouteHandler(admin)` still works unchanged — `options` is optional.
- `templates/_shared` is not touched; existing sites get the fix via the npm package update alone.
- `PREVIEW_BASE_CSS` content is unchanged (only the `<style>` tag gained an `id`).
