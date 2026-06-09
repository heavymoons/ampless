---
"ampless": patch
"@ampless/admin": patch
"@ampless/runtime": patch
"@ampless/plugin-youtube": patch
"@ampless/plugin-x-embed": patch
"create-ampless": patch
---

Make tiptap → html and markdown → html format switches produce the
embed placeholder div (= the canonical HTML embed form), completing
the 4-way format round-trip. Previously both paths silently dropped
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

All four format paths now converge on the placeholder div as the
canonical HTML embed form. The form round-trips through
`Node.parseHTML`'s existing `div[data-ampless-*]` rule, and
`publicHtmlForPost` continues to expand it to the real iframe at
public render time (concept separation preserved). Plugin author
guide updated to document both adapters together (also backfills
the PR #261 markdown-adapter docs that hadn't shipped yet).
