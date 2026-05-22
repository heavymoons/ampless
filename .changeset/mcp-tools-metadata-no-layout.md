---
"@ampless/mcp-server": minor
"@ampless/backend": patch
---

Expose `metadata` (with the `no_layout` well-known key) on the MCP
post tools.

The Post model has carried a free-form `metadata` JSON column since
v0.1, and the runtime treats `metadata.no_layout = true` (in
combination with `format: 'html'`) as "serve this post as a bare
HTML page — the public route 302-redirects to `/raw/<slug>` and
renders the body verbatim with no theme chrome". But the MCP tool
schemas hid both: `create_post` / `update_post` had no `metadata`
field at all, and `get_schema` didn't mention the well-known keys.
LLM clients had no way to publish a no-layout HTML page through the
HTTP MCP transport.

What's added:

- `create_post` / `update_post` schemas gain an optional
  `metadata` object property. `no_layout` is broken out as a typed
  sub-property with a description; other keys pass through via
  `additionalProperties: true` for themes / plugins.
- Tool descriptions in `tools/index.ts` now spell out the
  `metadata: { no_layout: true }` recipe for `create_post` and
  warn that `update_post`'s `metadata` is a full replace.
- `get_schema` reports `metadata` as a post field, with a new
  `notes.noLayout` entry explaining the route behaviour and a
  `notes.staticFormat` entry documenting that the underlying
  `static` format exists but its asset upload flow is admin-UI
  only (the MCP `upload_media` tool writes to `public/media/`
  not `public/static/`).
- `POST_FIELDS` GraphQL fragment now selects `metadata`, and
  `toCorePost` round-trips it through the same AWSJSON decoder
  used for `body` — handles both the JSON-string and
  native-object shapes Amplify stores depending on the resolver
  path.

What's intentionally NOT added in this PR:

- `format: 'static'` is still excluded from the tool enums. The
  bundle upload story needs `s3:PutObject` scoped to
  `public/static/*` plus a separate `upload_static_bundle` tool;
  documented under `notes.staticFormat` as deferred.
