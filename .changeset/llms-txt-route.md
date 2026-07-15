---
"@ampless/runtime": minor
"ampless": minor
"create-ampless": patch
---

Add the site-wide `/llms.txt` route — a single-file AI index of
recently published posts, continuing AI-readable publishing Phase 2.

- **`ampless`**: `AiConfig` gains `llmsTxt?: boolean | { limit?: number }`
  alongside the existing `markdownRoutes`. `false` disables the route;
  an object caps how many recent posts are listed (default enabled,
  `limit: 100`, clamped to 1..1000).
- **`@ampless/runtime`**: `createLlmsTxtRouteHandler` (new
  `@ampless/runtime/routes` export) serves an [llms.txt](https://llmstxt.org/)-style
  Markdown index — site name / description front matter followed by a
  flat list of published posts (newest first), each linking to its
  `/<slug>.md` projection (or the themed HTML page when
  `markdownRoutes: false`). Unlike `/<slug>.md`, this route isn't
  reached through a middleware rewrite — it's mounted directly and
  computes its own `Cache-Control` (5 min browser / 1h CDN / 1h
  stale-while-revalidate), the same pattern as the `/og/<slug>` route.
  The underlying published-post index returns full bodies rather than
  a summary projection, so the route bounds its own AppSync usage per
  request: at most 50 items per page, at most 21 pages, and it stops
  early (with a note in the output) if the same pagination token comes
  back twice. **Behaviour change**: `llms.txt` is now always a reserved
  slug — regardless of the `ai.llmsTxt` setting, a post whose slug
  happens to be `llms.txt` can no longer reach the themed route, the
  same "reserved" trade-off as `raw` / `static` / `md`.
- **`create-ampless`**: ships the new `app/llms.txt/route.ts` thin
  delegate, a `site.description` example, and an updated `ai` example
  in `cms.config.ts`.
