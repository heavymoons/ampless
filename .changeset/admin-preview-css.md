---
"@ampless/admin": minor
"create-ampless": patch
---

fix(admin): preview iframe now receives a full styled HTML document

## Cause

The admin post-preview iframe (`srcDoc`) showed embeds but no typography CSS
because the `/admin/preview` Route Handler was returning a bare HTML fragment
(`renderToStaticMarkup(body + scripts)` with no `<html>`/`<head>`/stylesheet).
An iframe loaded via `srcDoc` does **not** inherit the parent page's CSS;
`prose prose-neutral` classes on the iframe *element* only style its border-box,
not its content document. This has been a structural bug since PR #248.

## Fix

`createPreviewRouteHandler` (new export at `@ampless/admin/api`) now returns a
complete `<!doctype html>` document containing:

1. **Theme CSS vars** — `renderThemeCss(cssVars)` from `admin.loadThemeConfig()`,
   the same `:root {}` block the public root layout emits. Theme colour tokens
   now flow into the preview iframe.
2. **`PREVIEW_BASE_CSS`** — a self-contained typography approximation (h1-h6,
   p, ul/ol/li, a, code/pre, blockquote, img, table, hr; `prefers-color-scheme:
   dark` included). This is *not* pixel-perfect with the live theme: Next.js App
   Router emits hashed CSS bundles whose filenames are unknowable from a Route
   Handler. Goal is "readable preview", not identical rendering.

The template's `app/(admin)/admin/preview/route.tsx` is thinned to a 3-line
re-export shim (`create-ampless upgrade` syncs this file as part of the
`app/(admin)/admin` managed path, so existing sites receive the fix on their
next upgrade).

The misleading `prose prose-neutral dark:prose-invert max-w-none` classes are
removed from the iframe element in `post-form.tsx`.

## Existing-site update path

Run `npx create-ampless@latest upgrade` (or `pnpm update-ampless`) to receive
the thinned-out `route.tsx`. If you have customised that file, replace its body
with:

```tsx
import { admin } from '@/lib/admin'
import { createPreviewRouteHandler } from '@ampless/admin/api'
export const POST = createPreviewRouteHandler(admin)
```
