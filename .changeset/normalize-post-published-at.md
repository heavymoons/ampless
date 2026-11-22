---
'@ampless/backend': minor
'create-ampless': patch
---

Normalize `Post.publishedAt` at write time, rebuild tag-page rows from each post's current state, and add a one-time migration for existing rows. This is part of #406 and #389, and fixes neither on its own: the post list still reads the `byStatus` index, and switching it to the new index is a follow-up.

- **@ampless/backend**:
  - **Write-time normalization.** `defineAmplessBackend` inserts a VTL function into the generated `createPost` / `updatePost` pipelines, right before the DynamoDB write.
    - Every GraphQL write, including direct API calls that bypass the admin UI and MCP, now stores `publishedAt` as canonical UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`). It also derives the new `publishedAtSortKey` field (`<publishedAt>#<postId>`); a client-supplied value is ignored.
    - A value that is not a valid instant in UTC years 0000–9999 is rejected with `ValidationError`. Previously it was stored verbatim.
    - Synth fails if Amplify's generated pipeline no longer has the expected shape.
  - **New index.** A sparse GSI `byStatusSorted` (`status` / `publishedAtSortKey`) gives a unique, total order for stable paging. It is not read yet.
    - The Post table's `allowDestructiveGraphqlSchemaUpdates` is set to `false`. Without this, `ampx sandbox` would delete and recreate (empty) the Post table to add the index. Branch deploys add it in place either way.
  - **Tag-page (PostTag) rebuild.** It no longer writes the projection carried by the `post.index.refresh` event; the event is only a trigger.
    - The rebuild reads the post with a strongly consistent `GetItem`. It then deletes every key the event's previous or next state could occupy that is not a row of the current state, and puts the current state's rows.
    - **Every** write, delete or put, is a `TransactWriteItems` with a `ConditionCheck` that the post still holds exactly that state (`status`, `publishedAt`, `tags`, `slug`, `title`, `excerpt`, `format`, `updatedAt`), or that it still does not exist for a deleted post. If the post changed, the write is cancelled and the rebuild starts over, up to 5 attempts; after that it throws, so SQS retries and then sends the message to the DLQ.
    - So each committed write is correct when it commits. A worker acting on an old state can neither re-publish that state's row nor delete a row of the current state, wherever it crashes.
    - Previously, refresh events processed out of order (the trusted queue is SQS standard), or a post unpublished while its rows were being written, could leave rows for a draft or deleted post, exposing its title and excerpt through the public tag API; and a stale worker's delete could remove a current row.
    - Removal is still asynchronous: after an unpublish, the post's rows stay visible until its refresh event is processed, as before.
    - The trusted processor needs no new IAM: `ConditionCheckItem` is part of the existing read grant on Post.
  - **Event dispatcher.** A Post `MODIFY` that only changes how `publishedAt` is written (same instant) and/or `publishedAtSortKey` emits no `content.*` events and writes no PostHistory revision. It still triggers the tag-page rebuild.
  - **New bin `ampless-migrate-published-at`.**
    - `--table <Post table>`: rewrites existing rows. It is a dry-run by default, reads are strongly consistent, and `--apply` writes.
      - `--apply` is refused unless the table and `byStatusSorted` are `ACTIVE` and the index is no longer backfilling.
      - Each write is a conditional `UpdateItem` that sets only `publishedAt` / `publishedAtSortKey`, and only while those two still hold the values the scan read. An edit that changed either of them meanwhile is reported as a conflict. Edits to other attributes do not conflict and are not overwritten. `updatedAt` is never changed.
    - `--check-post-tags --post-tag-table <PostTag table>`: reports stale and missing tag-page rows. With `--apply`, it rebuilds them from each post's current state the same guarded way (deletes and puts). `--apply` writes are issued one at a time, each waiting for the rate limiter (`--max-writes-per-second`), with no bursts.
- **create-ampless**: the RUNBOOK (English and Japanese) documents the migration. A dry-run reporting nothing to change does not prove the migration is complete. Completion is established only with every writer stopped and `--check-post-tags` reporting no mismatch. Signs that the event pipeline has drained (dispatcher iterator age and errors, trusted queue, DLQ) are listed as evidence, not proof: the Post stream has no failure destination, so a batch that keeps failing is dropped.

**Upgrading:** deploy first. The first deploy builds the new index, which can take a while on large tables. Then follow the RUNBOOK section "Normalize stored post publish dates".
