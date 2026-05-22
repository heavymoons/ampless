---
"@ampless/runtime": minor
"@ampless/mcp-server": patch
"create-ampless": patch
---

Unify the `no_layout` HTML and static-bundle URLs under a single
`/_/<slug>` prefix.

Before:

- `/raw/<slug>` — bare HTML (`format=html` + `metadata.no_layout=true`)
- `/<slug>/<path>` — static-bundle asset (post `format=static`)
- the post dispatcher 308-redirected to `/raw/<slug>` for no_layout
  posts and 308-redirected to `/<slug>/<entrypoint>` for static posts

After:

- `/_/<slug>` — single entry point for both
- `/_/<slug>/` (trailing slash) — static-bundle entrypoint
- `/_/<slug>/<path>` — static-bundle internal file
- the post dispatcher 308-redirects both `metadata.no_layout` and
  `format='static'` posts to `/_/<slug>`; the new unified handler
  decides on `format` + `metadata.no_layout` and (for static) adds a
  trailing-slash 308 on the way to the presigned URL

Wins:

- One reserved URL namespace (`/_/`) instead of two (`/raw/` + the
  unprefixed slug-with-path pattern that previously competed with
  normal post routing).
- Static-bundle bundles no longer collide with normal post slugs.
- LLM-facing docs (`get_schema` notes, MCP tool descriptions) only
  have to teach one URL pattern.

Breaking changes (deliberately not back-compat — alpha):

- Old `/raw/<slug>` URLs return 404. No 301 redirect is emitted.
- Old `/<slug>/<path>` static URLs also return 404. The post
  dispatcher's redirect target carries existing single-segment links
  to `/_/<slug>/` automatically; only direct deep links to internal
  bundle files would have lingered.

Sites with deployed no_layout HTML posts or static bundles should run
`npm run update-ampless` to pick up the new route template, then
redeploy.

Implementation note: Next.js's App Router excludes any path part
starting with `_` from route discovery. The on-disk folder uses the
literal name `r/` (`app/site/[siteId]/r/[slug]/[[...path]]/route.ts`)
and the middleware rewrites the public `/_/` prefix to `/r/` at
request time. The browser URL stays `/_/<slug>(/...)`.
