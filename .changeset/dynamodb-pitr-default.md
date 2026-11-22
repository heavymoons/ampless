---
"@ampless/backend": minor
"create-ampless": patch
---

Enable DynamoDB point-in-time recovery (PITR) on every data table by default (#395).

- **`@ampless/backend`**: `defineAmplessBackend` now sets `pointInTimeRecoveryEnabled = true` on every entry of `backend.data.resources.cfnResources.amplifyDynamoDbTables` — all ampless models plus any project models from `amplify/data/resource.custom.ts`. Previously PITR was off (Amplify's default), so an accidental bulk delete or bad migration could not be rolled back.
- **In-place upgrade**: existing sites get PITR on the next deploy after upgrading. Amplify's table-manager custom resource applies it with `UpdateContinuousBackups`; no table is replaced, renamed, or copied. Setting the value explicitly also stops that handler from switching PITR back off on tables where it had been enabled by hand.
- **Cost**: PITR is billed on table size (data + LSIs), roughly $0.20/GB-month in us-east-1; restores roughly $0.15/GB. Prices vary by Region (https://aws.amazon.com/dynamodb/pricing/). Typical CMS tables are megabytes, so usually cents per month. The recovery window is DynamoDB's default 35 days.
- **Opt out** per table in `amplify/backend.custom.ts`: `backend.data.resources.cfnResources.amplifyDynamoDbTables['KvStore'].pointInTimeRecoveryEnabled = false`.
- **`create-ampless` templates**: `RUNBOOK.md` / `RUNBOOK.ja.md` now document the default, cost, and the restore-to-new-table procedure; `amplify/backend.custom.ts` gains a commented opt-out example.
