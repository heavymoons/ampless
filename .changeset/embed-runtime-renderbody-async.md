---
"@ampless/runtime": minor
---

**Alpha breaking — update theme pages.** `Ampless.renderBody(post)` now returns `Promise<ReactNode>` (was sync `string`) so `contentFields` plugin renderers (Phase 7) can run server-side and produce React subtrees. New sync companion `renderBodyHtmlString(post): string` covers the raw-route handler (`format: 'html', metadata.no_layout: true`) which doesn't expand embed shortcuts. New `publicPostScriptsForPage(posts): Promise<ReactNode>` aggregates plugin-supplied page-level scripts deduped by stable `id`. New low-level exports: `buildContentFieldRegistry`, `ContentFieldRegistry`, `RenderBodyOptions`.

Migration:

- Theme pages: change `dangerouslySetInnerHTML={{ __html: renderBody(post) }}` to `<div>{await ampless.renderBody(post)}</div>` and mark the enclosing page function `async`.
- Post detail / home (featured) pages: also add `{await ampless.publicPostScriptsForPage([post])}` after the body so widget scripts (e.g. x.com `widgets.js`) load on the public page.
- The raw route handler at `routes/raw.ts` switched internally from `renderBody` to `renderBodyHtmlString` — no template change needed.

- Markdown body rendering only intercepts bare URL paragraphs for embeds —
  `[caption](url)` markdown links and `<url>` autolinks render as normal
  links (= consistent with the page-level script detector which keys on
  bare URL lines)
- Non-embed markdown content + `format: 'html'` bodies use a block-safe
  `<div>` wrapper (was `<span>` in the initial PR draft, which was invalid
  markup around h1/p/ul tokens)
