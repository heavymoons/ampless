> 日本語版: [README.ja.md](./README.ja.md)

# @ampless/plugin-highlight

Syntax-highlighting plugin for [ampless](https://github.com/heavymoons/ampless). Highlights fenced code blocks on the public site using [highlight.js](https://highlightjs.org/) loaded lazily from a CDN.

> **Pre-release / beta.** Breaking changes possible in any minor version until v1.0.

The plugin injects a single inline script into `<head>` via the `publicHead` capability. On the public page the script scans for `<pre><code class="language-xxx">` blocks (excluding `language-mermaid`) and, **only if at least one exists**, injects the theme stylesheet and dynamically imports highlight.js from jsDelivr to highlight each block. Pages without a code block never download the library or the stylesheet.

No AWS data permissions are required — the descriptor is produced at request time in the public Next.js process and the highlighting happens in the browser. The plugin's `trust_level` is `untrusted`.

## Install

```bash
pnpm add @ampless/plugin-highlight@beta
```

## Configure

In `cms.config.ts`:

```ts
import { defineConfig } from 'ampless'
import highlightPlugin from '@ampless/plugin-highlight'

export default defineConfig({
  // ...
  plugins: [highlightPlugin()],
})
```

## Options

```ts
highlightPlugin({
  version: '11.11.1', // pinned default
  theme: 'github', // any highlight.js stylesheet name
})
```

| Option    | Default     | Notes                                                                                                                                                                                                                                                                                                                                               |
| --------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version` | `'11.11.1'` | highlight.js version loaded from jsDelivr. Must match `x` / `x.y` / `x.y.z`. Invalid values fall back to the default with a `console.warn`.                                                                                                                                                                                                         |
| `theme`   | `'github'`  | A highlight.js stylesheet name (e.g. `github`, `github-dark`, `atom-one-dark`, `monokai`). Must match `/^[a-z0-9][a-z0-9-]{0,40}$/`; anything else falls back to `github`. The corresponding `styles/<theme>.min.css` is loaded from the CDN. See the [highlight.js styles list](https://github.com/highlightjs/highlight.js/tree/main/src/styles). |

## How code blocks are detected

The plugin looks for `<pre><code class="language-xxx">` in the rendered post HTML and skips `language-mermaid`. The ampless toolbar's per-code-block **language editor** writes the `language-*` class, and all body formats land on the same shape:

| `post.format` | How the class appears                                                                 |
| ------------- | ------------------------------------------------------------------------------------- |
| `tiptap`      | The code-block node carries a `language` attribute → `class="language-ts"` on render. |
| `markdown`    | A fenced block ` ```ts ` → `class="language-ts"`.                                     |
| `html`        | Authored `<pre><code class="language-ts">` is preserved literally.                    |

Tag a fenced block with the language to highlight:

````markdown
```ts
const greet = (name: string) => `Hello, ${name}!`
```
````

A block with no `language-*` class (a plain ` ``` ` fence with no language) is left untouched.

## Coexistence with @ampless/plugin-mermaid

The two plugins are designed to run together in any order. This plugin's selector explicitly excludes `code.language-mermaid` (`:not(.language-mermaid)`), so a Mermaid diagram source is never syntax-highlighted; `@ampless/plugin-mermaid` replaces those `<pre>` blocks with rendered SVG. Already-highlighted blocks are guarded with `:not(.hljs)` so nothing is highlighted twice.

## Client-side robustness

- **Idempotent re-scan** — highlight.js adds the `hljs` class to processed blocks, and the selector guards on `:not(.hljs)`, so the scan never re-highlights.
- **SPA / App Router navigation** — the head script runs once, but a debounced `MutationObserver` on `document.body` re-scans when client navigation injects new post content.
- **Failure recovery** — if the dynamic import fails, the cached import promise is cleared so a later scan retries; failures are reported via `console.warn` rather than swallowed.
- **Theme stylesheet** — injected once with id `ampless-hljs-theme`, only when a highlightable block is present.

## Security / CDN notes

- **Pinned default version.** The default `version` is an exact `x.y.z` to minimize supply-chain surface. You may pass a floating major/minor tag (e.g. `'11'`), but the supply-chain risk of a floating tag is your responsibility.
- **Dynamic `import()` cannot use Subresource Integrity (SRI).** The library is fetched from jsDelivr at runtime; there is no integrity pin. Self-hosting the library / stylesheet is a possible future option.
- highlight.js only reads and re-marks the text content of code blocks; it does not execute the highlighted source.

## What it does not do (v1)

- **No build-time / server-side highlighting** — highlighting happens in the browser, so a no-JS client or the first paint shows unstyled (but readable) code.
- **No automatic language detection for unlabelled blocks** — only blocks with a `language-*` class are highlighted.
