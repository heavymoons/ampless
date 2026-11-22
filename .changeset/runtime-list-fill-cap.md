---
'@ampless/runtime': minor
'create-ampless': patch
---

List pages are no longer returned incomplete (#389 follow-up to #404). `listPublishedPosts` / `listPostsByTag` used to stop filling a page after 10 resolver calls and return a short, possibly empty, page with a `nextToken`. The home and tag views only read the first page, so they could show no posts even though older published posts existed. This happened when many rows with a non-canonical `publishedAt` came first (e.g. future `-05:00` values written through the API, #406).

- **Short pages are filled.** A resolver response can be short while the listing continues for two reasons: DynamoDB stops a Query at 1 MB (posts may be up to 400 KB), and the resolver drops rows after DynamoDB has applied `limit`. After a short page, the runtime reads 100-row chunks until the page is full.
- **Runtime cursor.** If a chunk holds more posts than the page needs, the returned `nextToken` is a runtime cursor (`ampless-c2.…`) that resumes inside that chunk. The cursor is a keyset position, not an offset: the chunk's start AppSync token, plus the sort key of the last returned post and the ids of returned posts sharing that key.
  - Posts deleted, unpublished, inserted or becoming live between two page requests never cause a later post to be skipped or repeated.
  - As with any keyset cursor, a post that appears at a position before the cursor is not shown on later pages.
  - Tokens without that prefix (or malformed ones) are still passed to AppSync unchanged.
- **Canonical data with small posts** still takes one call per page and gets the raw AppSync token.
- **The budget counts only empty calls**, meaning calls that return no new visible post. Large valid posts never fail: a 1 MB page always holds at least one row, so a page of 50 posts of 400 KB takes about 25 calls and succeeds.
  - A page makes at most `limit` + 20 resolver calls, each reading at most 100 rows and 1 MB.
  - After 20 empty calls, when the page is still short and the listing continues, the call throws the new exported `PostListScanLimitError` and logs with `console.error`. The error carries the posts collected so far, a `nextToken` to resume from, `calls` and `emptyCalls`.
  - The error message says the resolver dropped every row those calls read (non-canonical or unparseable `publishedAt`, or rows just outside `from` / `to`).
  - On the bundled `force-dynamic` pages this surfaces as an error response instead of an empty listing that hides posts. A short page always comes with `nextToken: null`.
- **New `fill?: boolean` option** (default `true`). With `fill: false` a call makes exactly one resolver call and returns the raw token. llms.txt and the public MCP tools use it: they already page with their own round-trip bounds (`collectBounded`), so one anonymous request cannot fan out into many resolver calls.
- Bundled resolver comments are updated to describe this; resolver behaviour is unchanged.
