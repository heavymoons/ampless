---
'@ampless/runtime': patch
---

Upgrade `marked` from `^14.1.4` to `^18.0.4` (runtime markdown
rendering). No source changes beyond a comment refresh — `marked.parse`
keeps the same signature for our usage (`{ gfm, breaks, async }`) and
the full `markdownToHtml` test suite (GFM tables, task lists, headings,
code blocks, links, images, blockquotes, lists, strikethrough,
horizontal rules) passes verbatim.
