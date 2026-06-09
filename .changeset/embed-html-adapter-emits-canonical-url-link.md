---
"@ampless/plugin-youtube": patch
"@ampless/plugin-x-embed": patch
---

Fix `tiptapNodeToHtml` adapter to emit the canonical URL as a clickable
link instead of the editor's visual span label.

Previously the adapter emitted
`<div data-ampless-{youtube,tweet} ...><span>{YouTube,Tweet}: id</span></div>`,
mirroring `Node.renderHTML`. That span is meant for the editor view
(visual placeholder for the embedded content), not the saved HTML. When
a post is saved as `format: 'html'` (= the destination of the
`tiptap → html` format switch), the adapter output ships to the public
page literally (`htmlPassthroughBlock` does no transformation), and
users saw `<span>Tweet: 2063778809632235750</span>` rendered on the
public page — editor labels leaking into final output.

The adapter now emits:

```html
<div data-ampless-tweet data-tweet-id="..." class="ampless-tweet-placeholder">
  <a href="https://x.com/i/status/...">https://x.com/i/status/...</a>
</div>
```

This:
- Removes the editor-internal label from the public HTML
- Mirrors the markdown canonical form (bare URL line), keeping the
  3-format mapping symmetric: tiptap Node ↔ bare URL line ↔
  `<div>` wrapping a bare URL link
- Gracefully degrades — viewers without iframe expansion still get a
  clickable link to the source content
- Does not affect round-trip: the parseHTML
  `tag: 'div[data-ampless-{youtube,tweet}]'` rule reads
  `data-{video,tweet}-id` via `addAttributes.<id>.parseHTML`, so the
  inner content is irrelevant for the html → tiptap path

`Node.renderHTML` keeps the span label (editor-internal visual cue
when the placeholder is shown live in the tiptap editor view).
