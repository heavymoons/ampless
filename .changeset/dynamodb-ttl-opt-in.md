---
"@ampless/backend": patch
"ampless": patch
"create-ampless": patch
---

Make DynamoDB TTL on KvStore / PostHistory an explicit opt-in, and correct the docs that promised automatic expiry (#399).

- **`@ampless/backend`**: `defineAmplessBackend` assigned `timeToLiveSpecification` on the KvStore and PostHistory table wrappers, but Amplify's `AmplifyDynamoDbTableWrapper` only has a `timeToLiveAttribute` setter, so the assignment never reached the template and TTL was never enabled. Rows written with `KvStore.put(..., { ttlSeconds })` or `history.retentionDays > 0` carry a `ttl` but have never been deleted. The inert assignments are removed and replaced by a comment explaining why TTL is left off.
- **No behaviour change on upgrade**: TTL stays off. The synthesized CloudFormation is identical to the previous release (verified by a real-synth test that compares every table's properties and every stack's resources), and Amplify's table manager makes no `UpdateTimeToLive` call, so a TTL you enabled by hand is left alone. Enabling TTL by default would immediately and irreversibly delete every row whose `ttl` has already passed, so it is not done for you.
- **Opt in** per table in `amplify/backend.custom.ts`, after the audit below: `backend.data.resources.cfnResources.amplifyDynamoDbTables['PostHistory'].timeToLiveAttribute = { attributeName: 'ttl', enabled: true }` (same for `'KvStore'`). The property name matters: `timeToLiveSpecification` does nothing.
- **`create-ampless` templates**: `RUNBOOK.md` / `RUNBOOK.ja.md` gain a "DynamoDB TTL for KvStore / PostHistory (opt-in)" section with a controlled migration: a read-only audit (`describe-time-to-live` plus a scan that counts already-expired rows), removing or raising `ttl` on rows you want to keep, confirming PITR as the safety net, the opt-in, and monitoring `TimeToLiveDeletedItemCount`. `amplify/backend.custom.ts` gains a commented opt-in example. The `cms.config.ts` and plugin author guide comments no longer say expired rows are deleted automatically.
- **`ampless`**: the `HistoryConfig.retentionDays` and `KvStore` doc comments now say that deletion only happens once table TTL is opted in.
