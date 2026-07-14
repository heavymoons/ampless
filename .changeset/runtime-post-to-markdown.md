---
"@ampless/runtime": minor
---

Add `postToMarkdown(post, opts?)` — the single post→Markdown conversion point for AI-readable publishing surfaces (the upcoming `/<slug>.md` route, llms-full, and public MCP `get_post`). It emits YAML frontmatter (public fields only: title / slug / publishedAt / updatedAt / tags / excerpt / canonical) followed by a format-dependent body: `markdown` verbatim, `tiptap` via `tiptapToMarkdown` with plugin embed adapters, `html` via the approximate `htmlToMarkdown`, and `static` as an entrypoint link plus excerpt. Also new: `buildMarkdownAdapterRegistry(plugins)` merges every plugin's server-safe `tiptapNodeToMarkdown` map (duplicate nodeType across plugins throws; non-function entries are skipped with a warning), exposed as `PluginHeadApi.markdownAdapters` and injected automatically by `ampless.postToMarkdown(post, opts?)`.

Behaviour change: unknown atom tiptap nodes (no children, no adapter) were previously dropped silently by `tiptapToMarkdown`; they now emit an `<!-- ampless:unsupported-node type="..." -->` placeholder comment (plus a console warning) so the omission stays auditable in markdown output. Unknown nodes with children still pass their children through unchanged.
