# Authoring posts

Posts are the single content type ampless ships with. They cover blog
articles, news items, About pages, marketing landings, and anything in
between. Three things shape how a post renders:

| Knob | Where | Effect |
| --- | --- | --- |
| `format` | post editor | how the body is parsed (`tiptap` / `markdown` / `html`) |
| `slug` | post editor | the public URL, plus a routing convention for bare HTML |
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
  See `docs/architecture/04-access-layer-mcp.md` for the trust model.

## Slug convention: bare HTML pages

A slug **ending in `.html`** is served by the layout-less route
handler. The middleware rewrites `/promo.html` →
`/site/<siteId>/raw/promo.html` internally; the URL stays `/promo.html`
in the browser. The response is the post body as `text/html` with
**no Next.js root layout and no theme chrome** — useful when you
need full control of `<head>`, custom `<style>`, tracking pixels,
etc.

```
slug: promo.html
format: html
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

Visit `/promo.html` → the body is returned as the entire HTTP
response.

### Why `.html$` and not a `format: 'rawhtml'` flag?

Pure URL convention. Middleware doesn't have to query the DB or
maintain a routing index — it just looks at the path suffix. Reaches
the right handler with zero infrastructure. As a side benefit, the
URL clearly signals "this is a stand-alone HTML page" to anyone
reading it.

### What about non-`html` formats with a `.html` slug?

The route handler still runs `renderBody`, so a markdown / tiptap
post served at `/x.html` produces an HTML fragment (no `<!DOCTYPE>`,
no `<head>`). Browsers render it, but you lose the metadata
benefits. Pair `.html` slugs with `format: 'html'` and write the
full document yourself.

### Same post at both URLs?

A post with slug `promo.html` is reachable only at `/promo.html`
(bare). A post with slug `promo` is reachable only at `/promo`
(theme-wrapped). To have both, create two posts. The featured-slug
mechanism (theme manifest field) and the various nav linkLists can
reference either form.

## URL summary

| Slug shape | URL | Renderer |
| --- | --- | --- |
| `myblog` | `/myblog` | theme post page (header / footer / etc.) |
| `tag-name` (matched via tag listing) | `/tag/tag-name` | theme tag page |
| `promo.html` | `/promo.html` | bare HTML route (no layout, no chrome) |
| (any) | `/raw/<slug>` | also reachable directly without the suffix convention |

`/raw/<slug>` always works as an explicit escape hatch — the slug
suffix is just the polished default.

## Featured / pinned content on the home page

Each theme that supports it (currently blog / landing / corporate)
has a `featuredSlug` manifest field in `/admin/sites/<siteId>/theme`.
Set it to a published post's slug; the theme renders that post's
body inline at the top of its home page and removes the same slug
from the regular feed to avoid duplication. See `docs/THEMES.md` for
where each theme places the featured block.
