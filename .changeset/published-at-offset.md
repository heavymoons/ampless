---
"ampless": minor
"@ampless/backend": patch
"@ampless/admin": patch
"create-ampless": patch
---

Decide scheduled-publish visibility by instant, not by string, so a `publishedAt` stored with a timezone offset (`+09:00`, `-05:00`, no seconds, ...) is no longer published at the wrong time (#389). AppSync's `AWSDateTime` accepts such values and direct GraphQL API writes store them verbatim; the admin UI and MCP tools already write canonical UTC. In particular, a negative-offset value (whose string sorts "earlier" than its instant) could previously go public before its scheduled time.

- **ampless**: new `parseAwsDateTime(value)` (AWSDateTime → epoch ms, `undefined` when invalid) and `canonicalizeAwsDateTime(value)` (→ fixed-width `YYYY-MM-DDTHH:mm:ss.sssZ`).
- **create-ampless**: bundled AppSync resolvers compare instants. `get-published-post` decides visibility by instant. `list-published-posts` canonicalizes `from` / `to` arguments before using them as key bounds and re-checks every returned row against now / `from` / `to` by instant. `list-posts-by-tag` re-checks rows by instant. A `publishedAt` that does not parse is treated as not yet published.
- **@ampless/backend**: the trusted processor writes PostTag rows (sort key and `publishedAt`) in canonical UTC, and deletes a post's old verbatim-keyed rows the next time it is saved. `listPublished()` (feed / sitemap source) filters and orders by instant.
- **@ampless/admin**: the "Scheduled" label follows the same instant-based rule.

No data is migrated or rewritten. Remaining limitation for existing non-canonical rows: `listPublishedPosts` still bounds and orders the `byStatus` index by its string sort key, so a positive-offset row appears in that listing late (never early) and may be out of order among mixed-offset rows. Existing PostTag rows keep their old key until the post is next saved. To fix such a post, re-set its publish date in the admin editor and save; the editor writes canonical UTC.

Existing sites must run `npx create-ampless@beta upgrade` (or `pnpm update-ampless`) to pick up the updated `amplify/data/*.js` resolvers, bump `@ampless/backend`, then redeploy.
