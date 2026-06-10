---
"@ampless/mcp-server": minor
"ampless": minor
"@ampless/admin": patch
"@ampless/backend": patch
---

**mcp-server (minor — breaking contract change):** `list_posts` now returns lightweight post summaries with no `body` or `metadata` (use `get_post` for content). The `nextToken` cursor is removed; replaced by stateless `offset` / `limit` pagination. New arguments: `query` (substring search), `tag` (exact filter), `sort` (kebab-case enum), `offset`. Response shape: `{ posts, total, offset, limit }`.

**ampless (minor):** `filterSortPostSummaries`, `collectTags`, and related types (`PostListSort`, `PostListStatusFilter`, `PostListFilterOptions`) are now exported from the core `ampless` package (moved from `@ampless/admin` internal lib).

**admin (patch):** Internal refactor — `posts-list-view.tsx` now imports `filterSortPostSummaries` / `collectTags` from `ampless` instead of the local lib file.

**backend (patch):** `mcp-handler.test.ts` updated to reflect the new `list_posts` contract (`{ posts, total, offset, limit }` instead of `{ posts, nextToken }`). Changeset Policy requires a changeset for any published package touched by a PR.
