---
"ampless": patch
"@ampless/runtime": patch
"@ampless/plugin-youtube": patch
"@ampless/plugin-x-embed": patch
"create-ampless": patch
---

Public html walker: `format: 'html'` posts now expand embed placeholder divs.

The admin's `tiptap → html` format switch serialises embed nodes (e.g.
`amplessYoutube`) to canonical placeholder divs
(`<div data-ampless-youtube data-video-id="…"><a href="…">…</a></div>`).
Previously the public render of a `format: 'html'` post shipped that div
literally, so the placeholder showed as a bare div + link instead of the
live embed. The runtime now parses `format: 'html'` bodies server-side
(`htmlparser2`, added as a direct runtime dependency) and expands each
**top-level** element carrying a registered placeholder flag attribute
into the plugin's existing `contentFields` `kind: 'tiptap'` renderer — so
the tiptap, markdown, and html formats all reach one renderer.

Plugins opt in via a new optional `htmlPlaceholder` field on their
`kind: 'tiptap'` `contentFields` entry (`flagAttr` + `attrsFromElement`).
`@ampless/plugin-youtube` and `@ampless/plugin-x-embed` declare it.

- **Top-level only**: placeholders nested inside `<blockquote>` / `<li>` /
  etc. stay literal.
- **Fast path / zero regression**: posts with no registered flag in the
  body are emitted as a single wrapper div, markup-identical to the
  previous raw passthrough. A post **with** placeholders becomes multiple
  wrapper divs interleaved with the embed siblings — the bytes inside each
  raw chunk are preserved exactly (original-string slices, never DOM
  re-serialisation), but the wrapper boundaries shift.
- **Graceful degradation**: if `attrsFromElement` or `render` throws, the
  runtime warns and falls back to the raw placeholder slice (its inner
  link stays clickable) rather than dropping engineer-authored content.
- **flagAttr is case-insensitive** and may be any attribute name (no
  fixed `data-ampless` prefix), so site-local plugins can use
  `data-my-embed`.

`@ampless/plugin-x-embed`'s `hasTweetIn` html branch now also matches
`data-ampless-tweet`, so widgets.js is injected when an html-format post
contains a tweet placeholder (without this, the expanded
`<blockquote class="twitter-tweet">` would not hydrate).

`renderBodyHtmlString` (the sync string path used by RSS) is unchanged —
it cannot embed React, so RSS keeps the placeholder div + link.
