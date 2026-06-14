---
"@ampless/runtime": patch
---

Fix React hydration mismatches on the public post page caused by client-side plugins that rewrite the rendered post body before hydration completes (e.g. `@ampless/plugin-mermaid` replaces a `<pre>` code block with an SVG `<div>`, `@ampless/plugin-highlight` injects spans into the `<code>`).

- markdown / html bodies (already opaque `dangerouslySetInnerHTML` passthroughs) now carry `suppressHydrationWarning`.
- tiptap code blocks now render as an opaque `dangerouslySetInnerHTML` island too, instead of a React-managed `<pre>`. `suppressHydrationWarning` only covers same-element attribute/text diffs — it does **not** cover element replacement (mermaid swapping the whole `<pre>`) or deep child injection (highlight's spans), which React 19 treats as a structural mismatch and regenerates the subtree for, deleting the plugin's output. Rendering the code block as an island React never traverses is the actual fix.

DOM note: the inner `<pre><code class="language-…">` source is preserved verbatim, but tiptap code blocks now gain one extra wrapper `<div>` (the same structure markdown/html bodies already have). `pre > code` selectors and descendant CSS (e.g. Tailwind Typography `.prose pre`) are unaffected; a `.prose > pre` direct-child selector now has the wrapper in between. No change to the emitted code source or SEO; no-JS rendering stays readable, with one wrapper `<div>` added around tiptap code blocks.
