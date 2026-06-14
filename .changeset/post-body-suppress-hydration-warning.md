---
"@ampless/runtime": patch
---

Fix React hydration mismatch warnings on the public post page. Client-side plugins (e.g. `@ampless/plugin-mermaid`, `@ampless/plugin-highlight`) rewrite the rendered post body — replacing `<pre>` code blocks with SVG or injecting highlight spans — before React finishes hydrating, which made React warn that the hydrated DOM no longer matched the server HTML. The post body is server-authoritative HTML with no React-managed state inside it, so it now renders with `suppressHydrationWarning` (on the `dangerouslySetInnerHTML` passthrough container for markdown/html bodies and on the tiptap code-block `<pre>`). No change to the emitted HTML, no-JS output, or SEO.
