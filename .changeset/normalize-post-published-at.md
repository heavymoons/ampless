---
'@ampless/backend': minor
'create-ampless': patch
---

Normalize `Post.publishedAt` at write time and add a one-time migration for existing rows (#406, part of #389). The post list still reads the `byStatus` index; switching it to the new index is a follow-up.

- **@ampless/backend**:
  - `defineAmplessBackend` inserts a VTL function into the generated `createPost` / `updatePost` pipelines, right before the DynamoDB write.
    - Every GraphQL write, including direct API calls that bypass the admin UI and MCP, now stores `publishedAt` as canonical UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`). A value that is not a valid instant in UTC years 0000–9999 is rejected with `ValidationError`. Previously it was stored verbatim.
    - The function also derives a new `publishedAtSortKey` field (`<publishedAt>#<postId>`); a client-supplied value is ignored.
    - Synth fails if Amplify's generated pipeline no longer has the expected shape.
  - New sparse GSI `byStatusSorted` (`status` / `publishedAtSortKey`): a unique, total order for stable paging. It is not read yet.
  - The Post table's `allowDestructiveGraphqlSchemaUpdates` is set to `false`. Without this, `ampx sandbox` would delete and recreate (empty) the Post table to add the index. Branch deploys add it in place either way.
  - The event dispatcher recognises a Post `MODIFY` that only changes how `publishedAt` is written (same instant) and/or `publishedAtSortKey`. For such a record it emits no `content.*` events and writes no PostHistory revision. It still refreshes the PostTag index.
  - New bin `ampless-migrate-published-at --table <PostTableName>` rewrites existing rows.
    - It is a dry-run by default; `--apply` writes.
    - Each write is a conditional `UpdateItem` that sets only `publishedAt` / `publishedAtSortKey`, and only if both still hold the values the scan read. A post edited meanwhile is reported as a conflict.
    - `updatedAt` is never changed. Writes are rate-limited, and re-running is safe.
- **create-ampless**: RUNBOOK (English and Japanese) documents the migration procedure.

**Upgrading:** deploy first. The first deploy builds the new index, which can take a while on large tables. Then run the migration from the RUNBOOK ("Normalize stored post publish dates") until the dry-run reports nothing to change.
