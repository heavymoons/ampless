---
"@ampless/backend": minor
---

PostHistory model + dispatcher revision capture (TTL-configurable).

Add a `PostHistory` model that snapshots each post save. The event-dispatcher
Lambda now writes one revision row per Post `INSERT` / `MODIFY` stream record
via the DDB SDK under its own IAM role (admin/editor read it back through
AppSync but never write it — same direct-write pattern as `PluginSecret`).

- New `createDispatcherHandler({ historyRetentionDays })` factory; the
  existing `handler` export stays as `createDispatcherHandler({ historyRetentionDays: 0 })`
  so un-upgraded template shells (`export { handler } from
  '@ampless/backend/events/dispatcher'`) keep working unchanged.
- Snapshot id is the deterministic `${postId}#${revisedAt}` (revisedAt =
  the new image's `updatedAt`, falling back to the record's
  `ApproximateCreationDateTime` — never invocation time), guarded by
  `ConditionExpression: attribute_not_exists(postHistoryId)` so stream
  at-least-once re-delivery is a no-op. `createdAt` / `updatedAt` are set
  to `revisedAt` (required, or AppSync returns null for the whole row).
- `ttl` is written only when `historyRetentionDays > 0`
  (`floor(epoch(revisedAt)) + retentionDays * 86400`); `backend.ts` enables
  DynamoDB TTL on the table and grants the dispatcher write access via
  `AMPLESS_POST_HISTORY_TABLE`.
- History writes are best-effort: failures are logged and swallowed so the
  dispatcher never re-throws (which would reprocess the batch and
  double-emit content events). If `AMPLESS_POST_HISTORY_TABLE` is unset the
  dispatcher logs once and skips history writes.
