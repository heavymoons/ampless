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
    - The rebuild reads the post with a strongly consistent `GetItem`, deletes every key the event's previous or next state could occupy, and writes the rows of the current state. It then re-reads the post and repeats if the post changed in the meantime, up to 5 attempts; after that it throws, so SQS retries and then sends the message to the DLQ.
    - Previously, refresh events processed out of order (the trusted queue is SQS standard) could re-create rows for a post that had since been unpublished or deleted. That exposed its title and excerpt through the public tag API.
  - **Event dispatcher.** A Post `MODIFY` that only changes how `publishedAt` is written (same instant) and/or `publishedAtSortKey` emits no `content.*` events and writes no PostHistory revision. It still triggers the tag-page rebuild.
  - **New bin `ampless-migrate-published-at`.**
    - `--table <Post table>`: rewrites existing rows. It is a dry-run by default, reads are strongly consistent, and `--apply` writes.
      - `--apply` is refused unless the table and `byStatusSorted` are `ACTIVE` and the index is no longer backfilling.
      - Each write is a conditional `UpdateItem` that sets only `publishedAt` / `publishedAtSortKey`, and only while those two still hold the values the scan read. An edit that changed either of them meanwhile is reported as a conflict. Edits to other attributes do not conflict and are not overwritten. `updatedAt` is never changed.
    - `--check-post-tags --post-tag-table <PostTag table>`: reports stale and missing tag-page rows. With `--apply`, it rebuilds them from each post's current state.
- **create-ampless**: the RUNBOOK (English and Japanese) documents the migration. A dry-run reporting nothing to change does not prove the migration is complete. Completion is established only with every writer stopped, the event pipeline drained (dispatcher iterator age, trusted queue, DLQ), and `--check-post-tags` reporting no mismatch.

**Upgrading:** deploy first. The first deploy builds the new index, which can take a while on large tables. Then follow the RUNBOOK section "Normalize stored post publish dates".
