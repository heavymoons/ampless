---
"ampless": patch
"@ampless/admin": patch
"@ampless/runtime": patch
"@ampless/plugin-youtube": patch
"@ampless/plugin-x-embed": patch
"create-ampless": patch
---

Make tiptap → html and markdown → html admin format switches produce
the embed placeholder div (= the canonical HTML embed form for the
admin format-switch round-trip). Previously both paths silently dropped
the embed: tiptapToHtml fell through the default switch with empty
children for atom Nodes, and markdownToHtml emitted
`<p><a href=URL>URL</a></p>` (bare GFM autolink).

Adds a `tiptapNodeToHtml` adapter map mirroring the
`tiptapNodeToMarkdown` map from PR #261. Plugins export both maps;
`update-ampless` codegens both `installAdminTiptapNodeHtml` and
`installAdminTiptapNodeMarkdown` into the bootstrap file. The admin
format switch becomes:

- tiptap → html: runtime consults the html adapter
- markdown → html: 2-hop via `generateJSON(...)` so the plugins'
  parseHTML rules promote bare URL paragraphs to embed Nodes, then
  the html adapter serialises them — no duplicate logic

Scope is **admin format-switch interop only**. The placeholder div
round-trips through `Node.parseHTML`'s existing `div[data-ampless-*]`
rule for `html → tiptap` and `html → markdown` switches; switching back
to `tiptap` or `markdown` restores the embed Node / bare URL line and
the existing public render walkers emit the real iframe.

**Public render of `format: 'html'` posts does NOT expand the
placeholder.** `publicHtmlForPost` adds `beforeContent` / `afterContent`
slots and does not transform the body — a html-format post that
contains a placeholder div shows the literal placeholder on the public
page. Authors who want public iframes should save as `tiptap` or
`markdown`. Adding a public html walker that expands `data-ampless-*`
placeholders to iframes is tracked as a separate follow-up (= new
`contentFields.html` capability + server-side HTML parser); see the
plugin author guide for the design sketch.

Plugin author guide updated to document both adapters together (also
backfills the PR #261 markdown-adapter docs that hadn't shipped yet)
and clarifies the public-render scope boundary.
