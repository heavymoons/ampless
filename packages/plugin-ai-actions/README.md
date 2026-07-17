> 日本語版: [README.ja.md](./README.ja.md)
>

# @ampless/plugin-ai-actions

Human-to-AI bridge links for [ampless](https://github.com/heavymoons/ampless) post pages. Injects a small `<p class="ampless-ai-actions">` element with up to three links, before or after the post content.

> **Pre-release / beta.** Breaking changes possible in any minor version until v1.0.

The links are emitted via the `publicHtmlForPost` capability (Phase 6d). Themes that call `ampless.publicHtmlForPost(post)` automatically render it. The runtime sanitizes the HTML with `sanitize-html` under a strict allowlist before it reaches the page — no `dangerouslySetInnerHTML` needed in the theme.

No AWS data permissions are required — everything runs at request time inside the public Next.js process. The plugin's `trust_level` is `untrusted`.

## Requires `ai.markdownRoutes`

**Every action this plugin renders depends on the post's `/<slug>.md` markdown projection** — including the two external AI links, which pass the absolute `.md` URL in the `?q=` prompt. If `ai.markdownRoutes: false` is set in `cms.config.ts`, the "View as Markdown" link 404s, and the Claude/ChatGPT links still open but hand the AI a `.md` URL that doesn't exist. **Do not register this plugin on a site with `ai.markdownRoutes` disabled** — `ai.markdownRoutes` defaults to enabled, so most sites don't need to think about this, but double-check before installing.

## Install

```bash
npm install @ampless/plugin-ai-actions@beta
```

## Configure

In `cms.config.ts`:

```ts
import { defineConfig } from 'ampless'
import aiActionsPlugin from '@ampless/plugin-ai-actions'

export default defineConfig({
  // ...
  plugins: [
    aiActionsPlugin(),
  ],
})
```

| Option | Default | Notes |
|---|---|---|
| `showMarkdownLink` | `true` | "View as Markdown" link to `/<slug>.md`. |
| `showClaude` | `false` | "Open in Claude" link. **Opt-in** — see [External AI links](#external-ai-links-opt-in) below. |
| `showChatgpt` | `false` | "Open in ChatGPT" link. **Opt-in** — same caveat. |
| `promptTemplate` | `'Read {url}'` | Prompt used for the Claude/ChatGPT `?q=` prefill. `{url}` is replaced with the absolute `.md` URL. |
| `position` | `'afterContent'` | `'beforeContent'` or `'afterContent'`. Opposite default of `@ampless/plugin-reading-time` — read the article, *then* offer the AI actions. |
| `instanceId` | `'ai-actions'` | Namespace used for runtime key resolution. Change only if registering the plugin twice. |

All display options except `instanceId` are also editable from `/admin/plugins → AI actions` without a redeploy — the constructor values above are just the initial defaults. `instanceId` is not part of `settings.public`, so it can only be set in `cms.config.ts`.

## External AI links (opt-in)

`showClaude` and `showChatgpt` default to **off**. The `https://claude.ai/new?q=...` and `https://chatgpt.com/?q=...` URL prefill pattern is a **widely-used community convention**, not a documented, versioned URL contract published by Anthropic or OpenAI. Behavior may differ by login state (signed in vs. signed out) and by platform (desktop vs. mobile), and either vendor could change or remove the query parameter without notice.

Before enabling either link, verify on your own site:

- Does the prompt prefill correctly when the visitor is logged in on desktop?
- Does it prefill correctly on mobile (native app vs. mobile browser can differ)?
- What happens when the visitor is signed out?

If the behavior is unreliable for your audience, leave the link off — the "View as Markdown" link alone (default on) already gives readers and AI tools a clean markdown entry point; a reader can open it and copy/paste into any AI chat manually.

## Why no "Copy Markdown" button

An earlier design considered a "Copy Markdown" button (clipboard write via `onclick`). It isn't implemented because the current plugin surface can't support it safely:

- `publicHtmlForPost`'s sanitizer drops all inline event handlers (`onclick`, etc.) and `<button>` elements — see the sanitizer profile in `@ampless/runtime`.
- `publicPostScript` (the other plugin surface that can add page JS) only accepts an external absolute `http(s)` script `src`; there is no inline-script channel for per-post logic today.

Without an inline-script capability or a plugin asset delivery mechanism, there's no way to wire a clipboard action into this descriptor-based surface. "View as Markdown" + browser "select all → copy" is the pragmatic substitute until a future capability makes Copy possible.

## Output HTML

```html
<p class="ampless-ai-actions">
  <a class="ampless-ai-actions-md" href="/my-post.md">View as Markdown</a>
  <span class="ampless-ai-actions-sep"> · </span>
  <a class="ampless-ai-actions-claude" href="https://claude.ai/new?q=Read%20https%3A%2F%2Fexample.com%2Fmy-post.md" target="_blank" rel="noopener noreferrer">Open in Claude</a>
  <span class="ampless-ai-actions-sep"> · </span>
  <a class="ampless-ai-actions-chatgpt" href="https://chatgpt.com/?q=Read%20https%3A%2F%2Fexample.com%2Fmy-post.md" target="_blank" rel="noopener noreferrer">Open in ChatGPT</a>
</p>
```

(Whitespace added above for readability — the actual output has no whitespace between elements.)

- The class names (`ampless-ai-actions`, `ampless-ai-actions-md`, `ampless-ai-actions-claude`, `ampless-ai-actions-chatgpt`, `ampless-ai-actions-sep`) are stable hooks for theme CSS. A modest default style (pill-shaped links) ships in the site template's `globals.css`, at zero specificity (`:where()`) so theme CSS can freely override it.
- Labels ("View as Markdown", "Open in Claude", "Open in ChatGPT") are fixed English strings in v1 — locale-aware labels are deferred until requested.
- The "View as Markdown" link is always **relative** (`/<slug>.md`), even when `site.url` is configured — it works regardless of the domain the page is served from.
- The Claude/ChatGPT links require an **absolute** `.md` URL (external services need a full URL). When the effective `site.url` is empty, those two links are omitted even if enabled — only "View as Markdown" renders.
- External links (`target="_blank"`) always carry `rel="noopener noreferrer"`, generated up front by the plugin (the runtime's sanitizer would also inject it, but generating it at the source keeps the plugin's own sanitize round-trip test exact-match).

## Trust level

`untrusted`. The plugin only emits an HTML descriptor validated and sanitized by `@ampless/runtime`. It does not access DynamoDB, S3, or any Lambda processor.

## What it does not do (v1)

- **Copy Markdown (clipboard)** — see [Why no "Copy Markdown" button](#why-no-copy-markdown-button) above.
- **On-page MCP connection info** — the public read-only MCP server is available when `cms.config.ai.publicMcp` is enabled, with connection details in `/llms.txt` and Admin → MCP tokens. Machine discovery is now covered by the experimental well-known catalog + Server Card (`cms.config.ai.mcpDiscovery`; see the repo's `docs/mcp.md`), and humans connect via that same guide, so a reader-facing on-page link/QR code was dropped rather than deferred. It can be revisited if requested.
- **Theme-specific CSS** — the plugin ships no per-theme styling. A neutral default (pill-shaped links) comes from the site template's `globals.css` at zero specificity (`:where()`); anything beyond that is up to theme CSS via the stable class names.
- **Locale-aware labels** — not supported. Link text is a fixed English string, and registering the plugin multiple times does not help: all instances render into the same position bucket, so themes cannot pick a per-locale slot. Deferred until requested.
