---
"ampless": minor
"@ampless/plugin-x-embed": patch
"@ampless/plugin-youtube": patch
"create-ampless": patch
---

Add `AmplessPlugin.tiptapNodeToMarkdown` — a server-safe manifest field so the public runtime can reach a plugin's tiptap-node-to-markdown adapters without importing `./editor` (which carries `'use client'` and `@tiptap/*`). `definePlugin()` now warns when a `contentFields` `kind: 'tiptap'` entry has no matching key in `tiptapNodeToMarkdown`.

- **ampless**: added the `tiptapNodeToMarkdown` field to `AmplessPlugin` (reuses the existing `TiptapNodeMarkdownAdapters` type) and a soft `definePlugin()` validation warning for missing adapter coverage. Also updated `packages/ampless/docs/plugin-author-guide.md` (+ `.ja.md`) — the source of truth for the guide — to document the new `./adapters.ts` split.
- **@ampless/plugin-x-embed** / **@ampless/plugin-youtube**: moved the `placeholderAttrs` / `escapeAttr` / `attrsToHtmlString` helpers and the `tiptapNodeToMarkdown` / `tiptapNodeToHtml` adapters out of `./editor.tsx` into a new tiptap-free `./adapters.ts`. `./editor.tsx` re-exports the two adapter maps (unchanged codegen contract for `update-ampless`), and `./index.tsx` now also sets `tiptapNodeToMarkdown` on the manifest. Pure refactor — no behavior change, no public API surface change beyond the manifest field.
- **create-ampless**: the `templates/_shared/docs/plugin-author-guide.md` (+ `.ja.md`) mirror is updated to match, and ships in the `create-ampless` npm tarball — a republish is needed for scaffolded projects to see the updated guide.
