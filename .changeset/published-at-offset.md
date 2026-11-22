---
'ampless': minor
'@ampless/backend': patch
'@ampless/admin': patch
'create-ampless': patch
---

Partial work on #389: single-post visibility, tag-index keys and plugin feeds now use the instant of `publishedAt` instead of its string. AppSync's `AWSDateTime` accepts offsets (`+09:00`, `-05:00`), missing seconds, etc., and direct GraphQL API writes store them verbatim. The admin UI and MCP tools already write canonical UTC. List pages are unchanged and still compare strings (see below, #406).

- **ampless**: new `parseAwsDateTime(value)` (AWSDateTime → epoch ms, `undefined` when invalid) and `canonicalizeAwsDateTime(value)` (→ fixed-width `YYYY-MM-DDTHH:mm:ss.sssZ`).
- **create-ampless**: the bundled `get-published-post` resolver decides visibility by instant. A future negative-offset post is no longer served early, a live positive-offset post is no longer hidden, and a `publishedAt` that does not parse is treated as not yet published. `list-published-posts` and `list-posts-by-tag` are unchanged from the previous release.
- **@ampless/backend**:
  - The trusted processor writes PostTag rows (sort key and `publishedAt`) in canonical UTC, so tag pages order and bound those rows correctly. A post's old verbatim-keyed rows are deleted the next time it is saved.
  - `listPublished()` (the source for plugin feeds and sitemaps) filters and orders by instant. It already read the whole published partition.
- **@ampless/admin**: the "Scheduled" label follows the same instant-based rule as the single-post page.

No data is migrated or rewritten. Remaining limitations, tracked in #406, for non-canonical `publishedAt` values (existing rows and new direct-API writes):

- `listPublishedPosts` still bounds and orders the `byStatus` index by its string sort key. A future negative-offset row can appear in the home list before its time, a live positive-offset row appears late, and mixed offsets may be out of order.
- Existing verbatim-keyed PostTag rows behave the same way on tag pages until the post is next saved.

To fix such a post, re-set its publish date in the admin editor and save; the editor writes canonical UTC. Existing sites must run `npx create-ampless@beta upgrade` (or `pnpm update-ampless`) to pick up the updated `amplify/data/get-published-post.js`, bump `@ampless/backend`, then redeploy.
