---
"ampless": minor
"@ampless/runtime": minor
"@ampless/admin": minor
"@ampless/plugin-youtube": patch
"@ampless/plugin-x-embed": patch
"create-ampless": patch
---

Make `tiptap → markdown` body-format conversion losslessly serialise
embed plugin nodes. Until this release, switching a post body from
`tiptap` to `markdown` in the admin silently dropped any
`amplessYoutube` / `amplessTweet` node — the runtime's
`tiptapToMarkdown` walker had no case for embed atoms and they fell
through with empty children.

Adds a plugin-side convention: plugins export
`tiptapNodeToMarkdown: TiptapNodeMarkdownAdapters` from their
`./editor` module (a `Record<nodeType, (node) => string | null>` map).
`update-ampless` regenerates `_editor-bootstrap.tsx` to register
those maps via the new `installAdminTiptapNodeMarkdown` from
`@ampless/admin/editor`. `tiptapToMarkdown(doc, { nodeAdapters })`
in `@ampless/runtime` checks the registry first per nodeType. Plugins
can return `null` to fall through to the default markdown serialiser.

The adapter returns a bare URL line (e.g.
`https://youtu.be/<videoId>`), and the existing markdown → tiptap
paste rule + `extractSingleUrl` (PR #258) re-converts that line back
to the embed node — so the round-trip is lossless.

The 1st-party `@ampless/plugin-youtube` / `@ampless/plugin-x-embed`
adopt the convention; older plugins that don't export
`tiptapNodeToMarkdown` are still picked up (codegen now uses
namespace imports + `?? {}`, so the missing export is a no-op rather
than a build error).

`ampless` minor: new public `TiptapNodeToMarkdown` /
`TiptapNodeMarkdownAdapters` types.
`@ampless/runtime` minor: `tiptapToMarkdown` gets an optional opts
argument; backward compatible.
`@ampless/admin` minor: new `installAdminTiptapNodeMarkdown` /
`getAdminTiptapNodeMarkdown` on the `./editor` subpath; existing
`installAdminEditorExtensions` unchanged.
`create-ampless` patch: codegen now uses namespace imports and emits
the new install line.
