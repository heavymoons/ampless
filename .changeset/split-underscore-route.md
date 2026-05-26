---
'@ampless/runtime': minor
'create-ampless': patch
'ampless': patch
---

Split the unified `/r/<slug>(/<path>)` internal route handler into two
focused handlers, one per behavior:

- **`createRawRouteHandler`** (`@ampless/runtime/routes`) handles
  `format: 'html'` posts with `metadata.no_layout === true`. Mounted
  at `app/raw/[slug]/route.ts`. Middleware rewrites `/<slug>` →
  `/raw/<slug>`.
- **`createStaticRouteHandler`** handles `format: 'static'` posts
  (S3 presigned redirect). Mounted at
  `app/static/[slug]/[[...path]]/route.ts`. Middleware rewrites
  `/<slug>(/<path>)` → `/static/<slug>(/<path>)`.

The removed `createUnderscoreRouteHandler` (mounted at `app/r/...`)
was a single function that dispatched on `post.format`, which mixed
two unrelated behaviors (HTML body vs S3 redirect) and tangled their
tests. Each new handler has its own focused test file
(`raw.test.ts`, `static.test.ts`) — easier to read, harder to
accidentally break the unrelated branch.

Public URL surface is unchanged: visitors still hit `/<slug>` and
`/<slug>/<path>`. The `/raw/` and `/static/` segments are internal
rewrite targets, both reserved in middleware so user posts with
those slugs short-circuit rather than collide with the rewrite.

For existing projects, `npm run update-ampless` (via
`create-ampless`) removes the old `app/r/[slug]/[[...path]]/route.ts`
through `AMPLESS_RETIRED_PATHS` and copies in the two new route
files automatically.
