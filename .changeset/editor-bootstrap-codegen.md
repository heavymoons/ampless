---
"create-ampless": minor
"@ampless/plugin-youtube": patch
"@ampless/plugin-x-embed": patch
"ampless": patch
---

Auto-wire admin editor extensions for embed plugins. Until this
release, sites that installed `@ampless/plugin-youtube` /
`@ampless/plugin-x-embed` had to uncomment 4 lines in
`app/(admin)/admin/_editor-bootstrap.tsx` to make the tiptap paste
rules work — and the next `update-ampless` would revert those edits
because the file lives in an ampless-managed app path.

`update-ampless` now regenerates `_editor-bootstrap.tsx` from the
project's `node_modules`: any package whose `package.json` declares
`amplessPlugin.editorExports` gets its editor extension imported and
installed automatically. Generated file carries a "Do not edit"
banner.

Plugin author convention added: declare `amplessPlugin.editorExports:
"./editor"` (the subpath where the editor module lives) in the
plugin's `package.json`, and export `editorExtension` as a named
symbol from that module. `@ampless/plugin-youtube` and
`@ampless/plugin-x-embed` adopt the convention; existing `youtubeEditor`
/ `tweetEditor` wrappers remain as legacy aliases for code that
hand-wired them before.

`ampless` patch covers an additive optional field on the public
`PluginPackageManifest` interface (`editorExports?: string`) and the
matching plugin-author-guide updates (both ship in the published
tarball via the `files` allowlist).
