---
"@ampless/plugin-ai-actions": minor
"@ampless/runtime": minor
"ampless": patch
"create-ampless": patch
---

New plugin `@ampless/plugin-ai-actions` (Phase B of the AI-readable publishing roadmap): injects a "View as Markdown" link (default **on**) after the post content, linking to the post's `/<slug>.md` route, plus two opt-in links — "Open in Claude" and "Open in ChatGPT" — that prefill a prompt with the absolute `.md` URL.

**The two external links default OFF.** The `https://claude.ai/new?q=...` / `https://chatgpt.com/?q=...` prefill pattern is a widely-used community convention, not a documented, versioned URL contract published by Anthropic or OpenAI — behavior can differ by login state and platform (desktop vs. mobile), and either vendor could change or drop the query param without notice. Site operators should verify the prefill works on their own site before opting in (`aiActionsPlugin({ showClaude: true, showChatgpt: true })`); see the plugin README for details.

**No "Copy Markdown" (clipboard) button.** An earlier design considered a Copy button but it isn't implementable on the current plugin surface: `publicHtmlForPost`'s sanitizer drops all inline event handlers (`onclick`, etc.) and `<button>` elements, and `publicPostScript` only accepts an external absolute `http(s)` script `src` — there's no inline-script channel for per-post logic today. "View as Markdown" + browser "select all → copy" is the pragmatic substitute until a future inline-script capability or plugin asset delivery mechanism makes Copy possible.

This plugin requires `ai.markdownRoutes` to stay enabled (the default) — every link it renders depends on the post's `/<slug>.md` route. Do not register it on a site with `ai.markdownRoutes: false`.

**`@ampless/runtime`: `PluginPublicRenderContext.site` now carries the effective site settings, not a static passthrough of `cms.config.ts`.** `createPluginHead(cmsConfig, pluginSettings, siteSettings)` gains an optional third argument; when supplied (as `createAmpless`'s internal wiring now does), `ctx.site` resolves through `siteSettings.loadSiteSettings()` — the admin `settings.public` override merged over `cms.config.ts` defaults, the same effective value the `/<slug>.md` route's canonical line already uses — instead of the static `cms.config.ts` site block. A site-settings fetch failure falls back to `cms.config.ts`, and callers that omit the third argument keep the prior (2-argument) behavior unchanged — this is why `@ampless/plugin-ai-actions`'s external AI links automatically track an admin-edited site URL without a redeploy. The `Config['site']` shape (`{ name, url, description? }`) is unchanged; only which value populates `ctx.site` for sites running the new `@ampless/runtime`.

`ampless` (plugin-author-guide doc source) and `create-ampless` (template + guide mirror + `AMPLESS_PACKAGES` distribution list) ship the accompanying documentation and scaffold wiring.
