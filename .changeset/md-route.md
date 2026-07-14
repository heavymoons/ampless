---
"@ampless/runtime": minor
"ampless": minor
"create-ampless": patch
---

Add the public `/<slug>.md` route — the canonical Markdown projection
of a published post, completing AI-readable publishing Phase A.

- **`ampless`**: new `Config.ai` section (`AiConfig`). Currently one
  switch, `markdownRoutes` (default `true`); `llmsTxt` / `publicMcp`
  land in the same section in later phases.
- **`@ampless/runtime`**: `createMarkdownRouteHandler` (new
  `@ampless/runtime/routes` export) serves `ampless.postToMarkdown()`
  as `text/markdown; charset=utf-8` for any published post format.
  Middleware strips a trailing `.md` off the first path segment
  *before* the AppSync flag lookup (so `/foo` and `/foo.md` share the
  same LRU entry) and rewrites to the internal `/md/<slug>` target —
  same shape as the existing `raw` / `static` internal rewrites.
  `markdownRoutes: false` turns this off entirely: `.md` is no longer
  special-cased and `/<slug>.md` resolves through the normal themed
  slug lookup, exactly as before this change. A post whose slug itself
  ends in `.md` is unreachable at its themed URL while the route is
  enabled — same "reserved" trade-off as slugs `raw` / `static` /
  `md`.
- **`create-ampless`**: ships the new `app/md/[slug]/route.ts` thin
  delegate and a commented-out `ai: { markdownRoutes: false }` example
  in `cms.config.ts`.
