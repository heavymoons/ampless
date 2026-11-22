---
'@ampless/runtime': minor
'create-ampless': patch
---

List pages are no longer returned incomplete when many index rows are dropped (#389 follow-up to #404). `listPublishedPosts` / `listPostsByTag` used to stop filling a page after 10 resolver calls and return a short, possibly empty, page with a `nextToken`. The home and tag views only read the first page, so they could show no posts even though older published posts existed. This happened when many rows with a non-canonical `publishedAt` (e.g. future `-05:00` values written through the API, #406) came first.

- After a short page, the runtime now reads 100-row chunks. If a chunk holds more posts than the page needs, the returned `nextToken` is a runtime cursor (`ampless-c2.…`) that resumes inside that chunk. The cursor is a keyset position, not an offset: the chunk's start AppSync token plus the sort key of the last returned post and the ids of returned posts sharing that key. Posts deleted, unpublished, inserted or becoming live between two page requests therefore never cause a later post to be skipped or repeated. As with any keyset cursor, a post that appears at a position before the cursor is not shown on later pages. Tokens without that prefix (or malformed ones) are still passed to AppSync unchanged, and canonical data still takes one call per page with the raw AppSync token.
- A page is still bounded to 20 resolver calls. If it cannot be filled within them while the listing continues, the call now throws the new exported `PostListScanLimitError`, which carries the posts collected so far, a `nextToken` to resume from, and the call count. It also logs with `console.error`. It no longer returns a short page. On the bundled `force-dynamic` pages this surfaces as an error response instead of an empty listing that hides posts.
- A short page now always comes with `nextToken: null`.
- Bundled resolver comments are updated to describe this; resolver behaviour is unchanged.
