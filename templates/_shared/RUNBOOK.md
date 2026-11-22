> 日本語版: [RUNBOOK.ja.md](./RUNBOOK.ja.md)
> 

# Runbook

Step-by-step recipes for occasional operations on an ampless-powered site — the things you don't do every day but want a reliable procedure for when you do.

For day-to-day usage (commands, admin UI tour, themes, plugins, deploying), start with [README.md](./README.md).

## Contents

- [AppSync API key (auto-renewed)](#appsync-api-key-auto-renewed)
- [Common operations](#common-operations)
  - [Promote / demote a user](#promote--demote-a-user)
  - [Reset a user's password (admin override)](#reset-a-users-password-admin-override)
  - [Restore a data table from point-in-time recovery](#restore-a-data-table-from-point-in-time-recovery)
  - [DynamoDB TTL for KvStore / PostHistory (opt-in)](#dynamodb-ttl-for-kvstore--posthistory-opt-in)
  - [Inspect failed plugin events](#inspect-failed-plugin-events)
- [Custom domains](#custom-domains)
  - [Adding a custom domain to Amplify Hosting](#adding-a-custom-domain-to-amplify-hosting)

## AppSync API key (auto-renewed)

Public blog reads (`listPublishedPosts`, `getPublishedPost`,
`listPostsByTag`) are gated by an AppSync API key. The key lives in
`amplify_outputs.json` and is therefore **visible to anyone visiting
the public site** — treat it as a low-trust credential. Its only
privilege is calling the three custom queries, which themselves only
return rows where `status === 'published'`.

### Why an API key (and not the Identity Pool guest role)?

Amplify Gen 2 `a.handler.custom` resolvers don't support `allow.guest()`
or `allow.authenticated('identityPool')` — only apiKey / userPool /
lambda / group / owner. ampless uses the API key for simplicity;
moving the public reads to a Lambda function data source
(`a.handler.function`) is a future option.

### Auto-renewal — no rotation runbook required

The `api-key-renewer` Lambda (see `amplify/functions/api-key-renewer/`)
is invoked by an EventBridge schedule on the 1st of every month at
03:00 UTC. It calls `AppSync.UpdateApiKey` to push `expires` to
"now + 364 days" on the existing key, so:

- the key id never changes,
- `amplify_outputs.json` stays valid,
- the Next.js app does not need to be rebuilt,
- at any moment, the key has at least ~334 days of remaining validity.

If you want to inspect or trigger it manually:

```bash
# verify current expiry
aws appsync list-api-keys \
  --region <region-from-amplify_outputs.json:data.aws_region> \
  --api-id <api-id-derived-from-amplify_outputs.json:data.url>

# manual run (e.g. after a long sandbox pause)
aws lambda invoke \
  --function-name $(aws lambda list-functions \
    --query "Functions[?contains(FunctionName,'api-key-renewer')].FunctionName | [0]" \
    --output text) \
  /tmp/out.json && cat /tmp/out.json
```

### If a key is suspected leaked

Immediate response is to rotate the key value (not just push expiry):

1. In `amplify/data/resource.ts`, edit a comment to force a CFN update
2. Run `npx ampx sandbox` (sandbox) or `npx ampx pipeline-deploy ...`
   (production) — Amplify regenerates the key value
3. Re-deploy the Next.js app so SSR picks up the new `data.api_key`

## Common operations

### Promote / demote a user

Use the AWS Cognito console:

1. User Pool → Users → pick the user
2. Group memberships → Add to / remove from group
3. Have the user sign out and back in for the new claims to apply

Groups: `ampless-admin` (full CRUD + ops), `ampless-editor` (content
CRUD), `ampless-reader` (reserved for future REST/MCP API consumers).

### Reset a user's password (admin override)

If someone is locked out and email-based recovery isn't an option:

```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id <pool-id-from-amplify_outputs.json:auth.user_pool_id> \
  --region <region> \
  --username <email> \
  --password '<new-password>' --permanent
```

The `/login` page also has a self-service "Forgot password?" flow.

### Restore a data table from point-in-time recovery

**PITR is on by default.** `defineAmplessBackend` enables DynamoDB
point-in-time recovery (PITR) on every data table — the ampless models
(Post, Page, Media, Taxonomy, KvStore, PostHistory, …) and any models
you add in `amplify/data/resource.custom.ts`. Existing sites get it on
the first deploy after upgrading `@ampless/backend` to a release that
includes this change (heavymoons/ampless#395). It is applied **in
place**: no table is replaced and no data is copied.

**Recovery window.** Tables that PITR is newly turned on for get
DynamoDB's default 35-day recovery period. Tables that already had PITR
on are left untouched, so a recovery period you configured earlier
(1–35 days) is kept; ampless does not reset it. Either way you can never
restore to a moment before PITR was turned on for that table. Check the
actual restorable range of a table before you restore:

```bash
aws dynamodb describe-continuous-backups --region <region> --table-name <live table> \
  --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription'
```

`EarliestRestorableDateTime` and `LatestRestorableDateTime` bound the
`--restore-date-time` you can pass; the latest point typically lags the
current time by about five minutes. `RecoveryPeriodInDays` shows the
configured window. Media files live in S3 and are not covered by PITR.

**Cost.** PITR is billed on table size (item data plus local secondary
indexes): roughly $0.20 per GB-month in us-east-1. A restore is billed
roughly $0.15 per GB of data restored (including GSIs). Prices vary by
Region — see [Amazon DynamoDB pricing](https://aws.amazon.com/dynamodb/pricing/).
A typical CMS table is megabytes, so this is usually cents per month.

**Restoring.** A restore always creates a **new** table; it never
rewinds the live one. Amplify manages the live table and its name stays
the same, so the procedure is: restore to a side table, copy the items
you need back into the live table, then delete the side table.

This is a selective, item-level repair, **not** a point-in-time rollback
of the site. Each table is restored separately, and copying items back
only overwrites the keys you write: rows created after the restore point
stay in the live table, and rows you don't copy keep their current
values. Related tables (e.g. Post, PostTag, PostHistory, KvStore) are
not rolled back together to a consistent moment.

1. Find the live table name (Amplify names them
   `<Model>-<apiId>-NONE`, e.g. `Post-abc123…-NONE`):

   ```bash
   aws dynamodb list-tables --region <region-from-amplify_outputs.json:data.aws_region>
   ```

2. Restore it to a new table at a moment inside the restorable range
   shown by `describe-continuous-backups` (see above):

   ```bash
   aws dynamodb restore-table-to-point-in-time \
     --region <region> \
     --source-table-name Post-<apiId>-NONE \
     --target-table-name Post-<apiId>-NONE-restore-20260101 \
     --restore-date-time 2026-01-01T09:00:00Z
   ```

   Wait until `aws dynamodb describe-table --table-name <target>` reports
   `TableStatus: ACTIVE` (minutes for small tables).

3. Plan the scope first: decide exactly which keys you are repairing,
   and compare them between the restored and live tables before writing
   anything. Then, while you copy:

   - **Isolate or quiesce writes.** Ask editors to stop editing (and
     pause any MCP clients or automation that write) so live changes
     don't race with the copy.
   - **`put-item` / `batch-write-item` replace the whole item with the
     same key.** Any newer change in the live row is lost. Items that
     exist only in the live table are not removed — delete them
     explicitly if they must go.
   - **Use conditional writes where appropriate**, e.g.
     `--condition-expression 'attribute_not_exists(postId)'` (use the
     table's partition key — `postId` for Post, `pk` for KvStore, …) to
     only re-create deleted rows without touching ones that still exist,
     or a condition on `updatedAt` so you don't overwrite a newer edit.

   Use `get-item` / `put-item` for a few rows, or a short `scan` +
   `batch-write-item` script for many (`batch-write-item` does not
   support conditions). Writes to Post / KvStore flow through their
   streams, so the event system re-runs for the restored rows (PostTag
   index, caches, history) as it does for any edit.

   Afterwards, **verify the reconciliation**: re-read the repaired keys
   from the live table, check the admin UI and public site, and check the
   events DLQ for failed processing.

   Do **not** point the app at the restored table, and do not delete the
   live table — Amplify owns it and will not adopt the copy.

4. Delete the restored table when you are done so you stop paying for
   it:

   ```bash
   aws dynamodb delete-table --region <region> --table-name <target>
   ```

The restored table keeps the key schema, indexes, and billing mode, but
does **not** carry over streams, TTL, PITR, tags, auto scaling, or IAM
policies. That is fine for a temporary side table; just don't treat it
as a drop-in replacement.

**Opting out.** To turn PITR off for a table, override it in
`amplify/backend.custom.ts` (it runs after ampless's wiring, so it
wins):

```ts
export function customizeBackend(backend: AmplessBackend): void {
  backend.data.resources.cfnResources.amplifyDynamoDbTables['KvStore'].pointInTimeRecoveryEnabled = false
}
```

### DynamoDB TTL for KvStore / PostHistory (opt-in)

**TTL is off by default.** Two tables write a `ttl` attribute (Unix epoch
seconds):

- **PostHistory** — each revision snapshot, when `cms.config.ts` sets
  `history.retentionDays` > 0 (`0` / unset writes no `ttl`).
- **KvStore** — rows written with `KvStore.put(pk, sk, value, { ttlSeconds })`
  (plugin caches / state).

ampless does **not** turn DynamoDB TTL on for either table, so nothing is
deleted automatically and rows past their `ttl` stay in the table — and
are still returned by reads (ampless does not filter them out).
Earlier releases appeared to enable TTL in `backend.ts`, but the
assignment never reached the deployed table (heavymoons/ampless#399).
Upgrading does not change this: TTL stays exactly as it is on each table,
including a TTL you enabled by hand.

It stays opt-in because **enabling TTL makes DynamoDB delete every row
whose `ttl` has already passed** — on a long-running site that can be
months or years of revisions or cache rows at once — and those deletes
cannot be undone except from a backup such as PITR. Turn it on per table, after the
checks below.

1. **Audit (read-only).** Find the live table name (`<Model>-<apiId>-NONE`,
   see `aws dynamodb list-tables`), check the current TTL state, and count
   the rows that would be deleted right away:

   ```bash
   aws dynamodb describe-time-to-live --region <region> --table-name <live table>

   aws dynamodb scan --region <region> --table-name <live table> \
     --select COUNT \
     --filter-expression 'attribute_exists(#t) AND #t < :now' \
     --expression-attribute-names '{"#t":"ttl"}' \
     --expression-attribute-values "{\":now\":{\"N\":\"$(date +%s)\"}}"
   ```

   The CLI follows `LastEvaluatedKey` for you and reports the total
   `Count` (rows already expired) and `ScannedCount` (rows read). A scan
   reads the whole table and consumes read capacity, so run it at a quiet
   time on large tables. Drop `AND #t < :now` to count every row that
   carries a `ttl`, and swap `--select COUNT` for
   `--projection-expression` with the key attributes (`postHistoryId` for
   PostHistory, `pk, sk` for KvStore) to list them.

2. **Decide what to keep.** Rows you want to keep must stop being
   expired **before** you enable TTL: remove the attribute, or raise it.

   ```bash
   aws dynamodb update-item --region <region> --table-name <live table> \
     --key '{"postHistoryId":{"S":"<id>"}}' \
     --update-expression 'REMOVE #t' \
     --expression-attribute-names '{"#t":"ttl"}'
   ```

   (KvStore's key is `{"pk":…,"sk":…}`; or use
   `--update-expression 'SET #t = :later'` with a future epoch). Changing
   `history.retentionDays` does not help here: it only affects revisions
   written after the change; existing rows keep the `ttl` they were
   written with. Writes to KvStore go through its stream like any edit
   (the dispatcher only acts on `siteconfig` rows).

3. **Confirm PITR is on** for the table — without it (or an on-demand
   backup) a TTL deletion cannot be undone — and note the start of the restorable range:

   ```bash
   aws dynamodb describe-continuous-backups --region <region> --table-name <live table> \
     --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription'
   ```

   `PointInTimeRecoveryStatus` should be `ENABLED`; `EarliestRestorableDateTime`
   is the oldest moment you can restore to. If something is deleted that
   you needed, follow [Restore a data table from point-in-time recovery](#restore-a-data-table-from-point-in-time-recovery)
   with a restore time just before you enabled TTL. Rows copied back still
   carry their past `ttl`, so remove or raise it as you copy, or TTL will
   delete them again.

4. **Opt in** in `amplify/backend.custom.ts` and deploy:

   ```ts
   export function customizeBackend(backend: AmplessBackend): void {
     backend.data.resources.cfnResources.amplifyDynamoDbTables['PostHistory'].timeToLiveAttribute =
       { attributeName: 'ttl', enabled: true }
   }
   ```

   Use the same line with `'KvStore'` for KvStore. The property name
   matters: it is `timeToLiveAttribute` (a setter on Amplify's table
   wrapper). `timeToLiveSpecification` is not a setter there; assigning it
   does nothing. Amplify's table manager applies the change in place with
   `UpdateTimeToLive`; no table is replaced. To turn TTL off again, remove
   the line and deploy.

5. **Monitor.** The CloudWatch metric `TimeToLiveDeletedItemCount`
   (namespace `AWS/DynamoDB`, dimension `TableName`) shows how many rows
   TTL deleted. Expect a burst over the first few days that roughly
   matches your audit count, then a steady trickle:

   ```bash
   aws cloudwatch get-metric-statistics --region <region> \
     --namespace AWS/DynamoDB --metric-name TimeToLiveDeletedItemCount \
     --dimensions Name=TableName,Value=<live table> \
     --start-time <ISO time you enabled TTL> --end-time <now, ISO> \
     --period 3600 --statistics Sum
   ```

**Caveats.**

- Deletion is not immediate. AWS deletes expired rows typically within a
  few days (the `UpdateTimeToLive` API reference says typically within
  two days, i.e. ~48 hours), and until
  then they are still returned by reads, queries and scans. ampless does
  not filter expired rows on read.
- DynamoDB ignores a `ttl` more than five years in the past, and any
  `ttl` that is not a Number; such rows are never deleted by TTL.
- A TTL change can take up to an hour to take effect, and another
  enable/disable on the same table within that hour fails with
  `ValidationException`. Don't toggle it in quick succession (e.g. deploy
  the opt-in, then immediately revert it).
- TTL deletes are free (no write capacity) and appear in the table's
  stream as `REMOVE` records from `userIdentity.principalId`
  `dynamodb.amazonaws.com`. ampless's dispatcher consumes the KvStore
  stream but only reacts to `siteconfig` rows (a site-settings cache
  rebuild), which are written without `ttl`; it does not consume the
  PostHistory stream. Check any stream consumers you added yourself.

### Inspect failed plugin events

Failed processor invocations land in the shared events DLQ created in
`amplify/backend.ts` (`EventsDlq`). View messages via the SQS console
or `aws sqs receive-message --queue-url <dlq-url> --max-number-of-messages 10`.
ampless doesn't ship an automated alarm out of the box — periodic
manual checks are recommended, or wire up a CloudWatch alarm on
`ApproximateNumberOfMessagesVisible`.

## Custom domains

ampless runs one site per Amplify deployment. To serve multiple sites
on different domains, deploy a separate Amplify environment per site.

### Adding a custom domain to Amplify Hosting

For each domain you want to bind:

1. **Amplify Hosting console** → your app → **Domain management** →
   **Add domain**.
2. Enter the apex domain (`example.com`) and the subdomains you want
   to attach. Amplify provisions an ACM certificate and a CloudFront
   SAN entry automatically.
3. Update DNS:
   - **Same DNS provider as Route 53 / Amplify managed**: Amplify
     creates the CNAMEs for you, just confirm.
   - **External DNS** (Cloudflare, Squarespace, etc.): Amplify shows
     CNAME / DNS verification records to copy. ACM email-validation
     also works as a fallback.
4. Wait for the **Domain activation** to finish (typically 15–60
   minutes; certificate validation is the slow step).
5. Update `cms.config.ts` so `site.url` reflects the new canonical URL,
   commit, and push to redeploy:
   ```bash
   git add cms.config.ts && git commit -m "feat: bind docs.example.com"
   git push   # Amplify Hosting picks it up
   ```

Verify end-to-end:

```bash
curl -I https://docs.example.com/   # 200 with your site's HTML
```
