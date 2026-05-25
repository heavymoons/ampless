---
'@ampless/backend': minor
'@ampless/admin': patch
'@ampless/mcp-server': patch
'ampless': minor
---

Centralise the `PostTag` denormalized-index maintenance into the
existing Stream → SQS → trusted-processor pipeline. Every Post
write now triggers an automatic PostTag refresh, regardless of the
write path (admin UI, MCP tools, future REST clients).

Previously each write path called its own `syncPostTags` helper
(one in `@ampless/admin`, one in `@ampless/mcp-server`). Any future
write path had to remember to call the same helper, and a failed
sync left posts saved but the public tag pages stale.

New plumbing:

- **`ampless`**: new `PostIndexEventType` / `PostIndexEventPayload`
  in the public events surface. `EventType` now includes
  `'post.index.refresh'`; the payload carries `{ previous, next }`
  content-event projections so subscribers can compute add /
  remove / update without re-reading DynamoDB.
- **`@ampless/backend`**:
  - Dispatcher emits `post.index.refresh` on every Post stream
    record (independent of the `content.*` status-transition
    events plugins already get).
  - Trusted processor gets a new built-in handler
    `rebuildPostTagsForPost` that delegates the diff math to a
    pure `computePostTagDiff` helper in `events/posttag-sync.ts`
    (fully unit-tested) and applies the result via direct
    DynamoDB Put / Delete.
  - Backend wiring grants the trusted Lambda `dynamodb:*` write
    access on the PostTag table and surfaces the table name as
    `AMPLESS_POSTTAG_TABLE`.
- **`@ampless/admin`**: posts-provider no longer maintains PostTag.
  `Post.create/update/remove` just write to AppSync; the Stream
  takes care of the index.
- **`@ampless/mcp-server`**: same — `create_post`, `update_post`,
  `delete_post`, and `upsert_static_post` no longer call
  `syncPostTags`. The standalone helper module
  `src/posttag.ts` (and its test) is removed.

Trade-off: PostTag refresh now lags Post write by Stream → SQS →
Lambda latency (typically 1–3 s) instead of being applied inline
by the writer. Tag pages on the public site can read a slightly-
stale index for a few seconds after a publish. For our usage
this is fine — the public side already has its own
60-second fetch cache TTL on `public/site-settings.json`, and tag
pages are not edit-then-immediately-view surfaces.

Migration: alpha break. After deploying this version the trusted
Lambda's IAM role needs the new `PostTag` grant — running
`npx ampx sandbox` once will refresh the policy. Stale PostTag
rows from before the deploy are not auto-cleaned, but the next
edit on each affected post will heal them through the same
diff logic.
