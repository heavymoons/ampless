---
"ampless": minor
"@ampless/runtime": minor
"@ampless/admin": patch
"@ampless/backend": minor
"@ampless/mcp-server": minor
"create-ampless": minor
---

Middleware-driven post routing + Lambda in-memory flag cache +
per-post Cache-Control strategy. Plus the URL flatten.

Public URLs collapse to `/<slug>` and `/<slug>/<path>` only. The
`/_/<slug>` reserved prefix is gone. The internal file system also
flattens: `app/site/[siteId]/...` → `app/...`.

Middleware now fetches `post.format` + `post.metadata` +
`post.updatedAt` from AppSync (apiKey auth, single small GraphQL
query) and rewrites the request to the right internal handler:

- themed post → no rewrite, served by `app/[slug]/page.tsx`
- `metadata.no_layout: true` HTML or `format: 'static'` →
  `/r/<slug>(/<path>)`, served by `app/r/[slug]/[[...path]]/route.ts`

A 200-entry LRU with a 60-second TTL caches the flag lookup in
Lambda module scope (Node runtime). Hot slugs cost zero AppSync
queries for the duration of the cache window.

`Cache-Control` is computed by middleware and set on the response:

- `metadata.cache: 'auto'` (default) — `no-store` within
  `cms.config.cache.cooldownMs` of `updatedAt` (default 1h); then
  `public, max-age=<freshTtlSeconds>, s-maxage=<freshTtlSeconds>`
  (default 300 sec / 5 min).
- `metadata.cache: 'deep'` — always `public, max-age=<deepTtlSeconds>,
  s-maxage=<deepTtlSeconds>` (default 3600 sec / 1 hour).
- `metadata.cache: 'hot'` — always `no-store`.

`metadata.cache` is independent of `metadata.no_layout` and `format`
— the same three strategies apply uniformly to themed, no_layout,
and static posts.

Schema change: the `PublicPost` customType in `@ampless/backend` now
includes `updatedAt` (DynamoDB auto-managed; the JS resolvers pass
items through verbatim, so the field becomes available once the
schema declares it). This is an additive projection — existing data
is unaffected, but downstream sandboxes / production deploys must
re-`ampx deploy` to pick up the new schema.

MCP tools: `create_post` and `update_post` schemas now advertise
`metadata.cache` alongside `metadata.no_layout`; `get_schema.notes`
gains `cacheStrategy` with the full contract.

Breaking changes:

- `createAmplessMiddleware` factory gains two required opts:
  `appsyncUrl` and `apiKey`. Template `proxy.ts` updated to pass
  these from `amplify_outputs.json` (`outputs.data.url` and
  `outputs.data.api_key`). Downstream projects must run
  `update-ampless` to pick up the new shape.
- `/_/<slug>` no longer works. Bookmarks / external links to the
  reserved underscore namespace will 404. (v0.2 alpha — no external
  link weight to preserve.)
- `app/site/[siteId]/` files moved to `app/` directly. `create-ampless upgrade` cleans up the obsolete files but doesn't copy user-authored content out.
- `ThemeRouteContext.params` no longer carries `siteId`. Themes that
  read `siteId` from `params` must drop the field (the value was
  always `'default'`).
