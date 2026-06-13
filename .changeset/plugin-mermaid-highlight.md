---
'@ampless/plugin-mermaid': minor
'@ampless/plugin-highlight': minor
---

Add two first-party client-side code-block decoration plugins built on the `publicHead` capability:

- `@ampless/plugin-mermaid` — renders `<pre><code class="language-mermaid">` blocks as diagrams via mermaid.js, lazily imported from jsDelivr only when a page actually contains a Mermaid block. Replaces the `<pre>` with `<div class="ampless-mermaid">…svg…</div>`. Options: `version` / `theme` (default | dark | forest | neutral | base) / `securityLevel` (default `strict`).
- `@ampless/plugin-highlight` — syntax-highlights `<pre><code class="language-*">` blocks (excluding `language-mermaid`) via highlight.js, lazily imported from jsDelivr with the theme stylesheet injected on demand. Options: `version` / `theme` (any highlight.js stylesheet name, default `github`).

Both inject a single inline script that runs an idempotent `scan()` on `DOMContentLoaded` plus a debounced `MutationObserver` so client-side (App Router) navigation re-decorates late-arriving post content, cache the dynamic `import()` promise, and reset it on failure for retry. Constructor options are validated/normalized on the Node side (version regex, theme/securityLevel allowlists) before being embedded into the script body to prevent injection. Both are `trust_level: 'untrusted'` and require no AWS data permissions. The two plugins coexist in any order: highlight skips `language-mermaid`, and mermaid replaces the whole `<pre>`.
