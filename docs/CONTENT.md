> 日本語版: [CONTENT.ja.md](./CONTENT.ja.md)
> 
# Authoring posts

Posts are the single content type ampless ships with. They cover blog
articles, news items, About pages, marketing landings, and zip-uploaded
static HTML/CSS/JS bundles. Four things shape how a post renders:

| Knob | Where | Effect |
| --- | --- | --- |
| `format` | post editor | how the body is stored and parsed (`tiptap` / `markdown` / `html` / `static`) |
| `no_layout` | post editor (only shown when `format: 'html'`) | render the body verbatim with no Next.js layout and no theme chrome |
| `cache` | `metadata.cache` (auto/deep/hot) | override the per-post cache strategy |
| `slug` | post editor | the public URL |
| `status` | post editor | `published` posts appear publicly; `draft` are admin-only |

## Formats

- **Tiptap** — the rich text editor. Stored as a structured document.
  Best default for blog-style content. Images, links, headings, lists.
- **Markdown** — a plain textarea. Ampless ships a minimal renderer
  (headings, bold, code, lists, paragraphs). For full Markdown
  features bring your own renderer.
- **HTML** — a plain textarea. The body is rendered verbatim — no
  sanitization. The editor (you) is treated as a trusted principal.
  Useful when you need custom HTML / inline `<style>` / scripts.
  See [docs/architecture/04-access-layer-mcp.md](./architecture/04-access-layer-mcp.md) for the trust model.
- **Static** — upload a `.zip` (or a folder via drag & drop) containing
  HTML / CSS / JS / images / fonts. Ampless extracts the bundle,
  stores the files in S3, and serves them through the public site.
  See "Static bundles" below.

## `no_layout: true` — bare HTML pages

When you need a page with full control of `<head>`, custom `<style>`,
tracking pixels, or anything else that can't share Next.js's root
layout and theme chrome, set **`format: 'html'`** and toggle the
**No layout** checkbox on the post editor.

What happens internally:

- The flag is stored as `metadata.no_layout: true` on the post.
- The proxy (middleware) sees `format: 'html'` + `metadata.no_layout: true`
  on the AppSync flag fetch and rewrites the `/<slug>` request to the
  internal bare-HTML handler.
- The handler returns the post body as `text/html` with **no Next.js
  root layout and no theme chrome**. The browser URL stays `/<slug>`.

```
slug: promo
format: html
no_layout: ☑
body: <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>Promo</title>
        <meta name="description" content="..." />
        <style>body { ... }</style>
      </head>
      <body>
        ...
      </body>
      </html>
```

Visiting `/promo` → the body is returned as the entire HTTP response.

### `no_layout` only makes sense with `format: 'html'`

The **No layout** checkbox is only visible when `format: 'html'`. For
tiptap / markdown bodies, "no layout" would just produce a
context-less HTML fragment without `<!DOCTYPE>` or `<head>`. Changing
the format away from `html` automatically clears the flag.

## Static bundles (`format: 'static'`)

A static post hosts a tree of plain HTML / CSS / JS / image / font
files. Useful for marketing microsites, hand-rolled landing pages,
single-page exports from another generator, design experiments — any
content that isn't a blog post but should live under your site's
domain.

### Uploading

In the post editor, set **format: static**. The editor swaps the
body area for a `StaticUploader`:

- Drop a `.zip` of the bundle, **or**
- Drag a folder (Chrome / Edge: `webkitdirectory` support), **or**
- Pick multiple files.

Ampless extracts the zip in the browser, validates the file list,
and uploads each file to S3 when you save the post. On re-save the
previous bundle is deleted before the new one uploads — bundles are
replaced atomically, not merged.

### What you can upload

| Allowed | Notes |
| --- | --- |
| `.html`, `.htm` | served as `text/html` |
| `.css`, `.js`, `.mjs`, `.json` | served verbatim |
| `.svg`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.ico` | images |
| `.woff`, `.woff2`, `.ttf`, `.otf`, `.eot` | fonts |
| `.pdf`, `.txt`, `.xml`, `.map` | misc |
| Other extensions | served as `application/octet-stream` |

Max bundle size: **50 MB uncompressed**. macOS metadata
(`__MACOSX/`, `.DS_Store`) and Windows `Thumbs.db` are auto-stripped.
A common top-level directory is auto-flattened — drop `mybundle.zip`
and `mybundle/index.html` becomes `/<slug>/index.html`.

HTML / CSS / SVG files are linted for absolute-path references
(`href="/style.css"`, `url(/img.png)`) and path-traversal sequences
(`../`) at validation time; offending files are surfaced in the UI
and save is blocked until they're fixed. Use **relative** paths
(`./style.css`, `assets/img.png`).

### URL layout

```
/<slug>                    → 308 redirect → /<slug>/  (anchor trailing slash)
/<slug>/                   → S3 presigned URL for the entrypoint (302)
/<slug>/assets/style.css   → S3 presigned URL (302)
```

The browser URL stays `/<slug>` / `/<slug>/<path>` throughout —
middleware rewrites these to the internal static-bundle handler at
request time. The `entrypoint` defaults to `index.html` and is
detected from the uploaded files; you can override it in the uploader
UI. Every file in the bundle is reachable at `/<slug>/<relative-path>`.

### Storage layout

```
s3://<bucket>/public/static/<slug>/...
```

The bucket stays private. The public route signs short-lived
(1-hour) URLs on demand and 302-redirects the browser to them. The
asset itself is then served by S3.

### Limitations

- Bundles are not executed — they're static assets only. You can't
  ship a `.php` file or a Lambda.
- No incremental updates within a bundle — each save replaces the
  whole bundle.
- Absolute paths, `../` traversal, and null bytes are rejected by
  validation. Author your bundle with relative paths.

## Cache strategy (`metadata.cache`)

Each post response carries a `Cache-Control` header computed by the
proxy. The default behaviour is **cooldown by edit time** — recent
edits emit `no-store` so editors see fresh content immediately; once
the cooldown elapses the post becomes CDN-cacheable.

Override per post via `metadata.cache`:

| Value | Behaviour |
| --- | --- |
| `'auto'` (default) | `no-store` within `cms.config.cache.cooldownMs` (default 1h) of `updatedAt`; then `public, max-age=<freshTtlSeconds>, s-maxage=<freshTtlSeconds>` (default 5 min). |
| `'deep'` | always `public, max-age=<deepTtlSeconds>, s-maxage=<deepTtlSeconds>` (default 1 hour). Use for posts whose content is fixed for the foreseeable future. |
| `'hot'` | always `no-store`. Use for rapidly-evolving posts or bodies computed per request. |

Project-wide knobs live in `cms.config.ts`:

```ts
export default defineConfig({
  // ...
  cache: {
    cooldownMs: 60 * 60 * 1000, // 1 hour — auto strategy cooldown
    freshTtlSeconds: 300,       // 5 minutes — auto post-cooldown TTL
    deepTtlSeconds: 60 * 60,    // 1 hour — deep strategy TTL
  },
})
```

`metadata.cache` is independent of `metadata.no_layout` and `format` —
the same three strategies apply uniformly to themed, no_layout, and
static posts.

## URL summary

| Post setting | Public URL | Renderer |
| --- | --- | --- |
| `format: 'tiptap' \| 'markdown' \| 'html'` (no `no_layout`) | `/<slug>` | theme post page (header / footer / etc.) |
| Tag listing | `/tag/<tag-name>` | theme tag page |
| `format: 'html'` + `no_layout: true` | `/<slug>` | bare HTML route (no layout, no chrome) |
| `format: 'static'` | `/<slug>/` | static bundle served from S3 via presigned URL |
| Any format | `/<slug>.md` | Markdown projection of the post (`ampless.postToMarkdown()`) |
| Site-wide | `/llms.txt` | AI index of recent published posts, disable with `ai.llmsTxt: false` |
| Site-wide | `/api/mcp` | Anonymous read-only MCP endpoint (JSON-RPC 2.0 over POST, published posts only); enable with `ai.publicMcp: true` |

## AI-readable Markdown (`/<slug>.md`)

Every published post — regardless of `format` — is also available as
Markdown at `/<slug>.md`. The response is generated by
`ampless.postToMarkdown()`: YAML frontmatter (title / slug /
publishedAt / updatedAt / tags / excerpt / canonical) followed by the
format-dependent body — `markdown` verbatim, `tiptap` converted via
`tiptapToMarkdown` (with plugin embed adapters), `html` via an
approximate `htmlToMarkdown`, and `static` as an entrypoint link plus
excerpt.

Disable the route project-wide with:

```ts
export default defineConfig({
  // ...
  ai: { markdownRoutes: false },
})
```

Like every other public route, `/<slug>.md` only ever serves
`published` posts — drafts 404 the same way `/<slug>` does.

## Site-wide AI index (`/llms.txt`)

`/llms.txt` follows the [llms.txt](https://llmstxt.org/) convention: a
short site name / description front matter followed by a flat list of
the most recently published posts, each linking to its `/<slug>.md`
projection (or the themed HTML page when `markdownRoutes: false`).
It's mounted directly — unlike `/<slug>.md` it isn't reached through a
middleware rewrite — and served with `text/plain` plus a self-computed
`Cache-Control` (5 min browser / 1h CDN, 1h stale-while-revalidate).

The list is capped at 100 posts by default. The underlying published
index returns full post bodies rather than a lightweight summary, so
listing hundreds of posts means walking several paginated,
comparatively expensive reads; raise the cap deliberately once you
know your post bodies are small enough that it's worth it:

```ts
export default defineConfig({
  // ...
  ai: { llmsTxt: { limit: 200 } }, // default 100, clamped to 1..1000
})
```

Disable the route entirely with `ai: { llmsTxt: false }`. Either way,
**`llms.txt` becomes a reserved slug** — a post whose slug happens to
be `llms.txt` can no longer reach the themed route, the same as
`raw` / `static` / `md`.

## Featured / pinned content on the home page

Each theme that supports it (currently blog / landing / corporate)
has a `featuredSlug` manifest field in `/admin/sites/<siteId>/theme`.
Set it to a published post's slug; the theme renders that post's
body inline at the top of its home page and removes the same slug
from the regular feed to avoid duplication. See [THEMES.md](./THEMES.md) for
where each theme places the featured block.
