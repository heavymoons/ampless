---
"@ampless/admin": minor
"@ampless/backend": minor
"@ampless/mcp-server": minor
"ampless": patch
"create-ampless": patch
---

Add scheduled publishing: a `published` post with a future `publishedAt` is now hidden from all public reads (post page, listings, tag pages, feed.xml, sitemap.xml) until that time, and the admin editor exposes an editable `publishedAt`.

- **@ampless/admin**: the post editor now has an editable publish date (`datetime-local`). Publishing without a date stamps the current time; an existing `publishedAt` is preserved (no longer cleared when reverting to draft). A future date schedules the post.
- **@ampless/backend**: the trusted processor's `listPublished()` (feed/sitemap source) now excludes future-dated posts.
- **@ampless/mcp-server**: `create_post` / `update_post` / `commit_static_post` normalize an explicit `publishedAt` to canonical UTC and fill `publishedAt = now` when publishing without one, so published posts always appear in listings.
- **create-ampless**: bundled AppSync resolvers (`get-published-post`, `list-published-posts`, `list-posts-by-tag`) now filter out future-dated published posts server-side.
- **ampless**: plugin-author guide documents that `content.published` fires at save time (not at the scheduled time), so notification plugins should gate on `publishedAt`.

Timing is best-effort: scheduled posts become visible within the natural cache window (≤ ~5 min by default) after `publishedAt`, not to the second. Existing deployed sites must update their `amplify/data/*.js` resolvers AND bump `@ampless/backend`, then redeploy.
