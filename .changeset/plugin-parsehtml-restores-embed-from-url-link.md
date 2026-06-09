---
"@ampless/plugin-youtube": patch
"@ampless/plugin-x-embed": patch
"ampless": patch
"create-ampless": patch
---

Restore embed Nodes when the admin format switches `markdown -> tiptap`.

The previous `tiptap -> markdown` path serialized YouTube and X embed nodes
to bare URL lines, but switching the markdown back to tiptap left those URLs
as ordinary Link-marked text. The admin converts markdown to HTML first, so a
bare URL line becomes `<p><a href="https://...">https://...</a></p>` and
tiptap parses that HTML directly; paste rules do not run on that path.

The YouTube and X embed editor nodes now declare high-priority
`Node.parseHTML()` rules for single-link URL paragraphs, plus `a[href]`
fallback rules for other HTML-to-tiptap paths. Non-matching links return
`false` and continue to parse as normal Link marks.

The plugin author guide now documents this markdown-to-tiptap restoration
pattern in both the `ampless` docs and the shared `create-ampless` template
docs.
