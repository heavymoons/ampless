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
  - [Normalize stored post publish dates (one-time migration)](#normalize-stored-post-publish-dates-one-time-migration)
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
  `history.retentionDays` > 0 (`0` / unset writes no `ttl`). The only
  writer ampless ships is the event-dispatcher Lambda, which `PutItem`s a
  revision for every Post save it reads from the Post stream (retried up
  to 3 times, so a record can be written again well after the save).
- **KvStore** — rows written with `KvStore.put(pk, sk, value, { ttlSeconds })`
  (plugin caches / state). ampless writes KvStore only from admin / editor
  sessions through AppSync (the admin UI); any custom code, script or
  integration you added is a writer too.

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
cannot be undone except from a backup such as PITR. Turn it on per table,
in a maintenance window, with the procedure below.

**Why the writers must be stopped first.** A scan is not a snapshot: it
reads the table page by page over time, and a row written, rewritten or
re-delivered during or after the scan may not be in its result. Any such
row whose `ttl` is already past (or passes before you finish) is deleted
by TTL without ever having been reviewed. The audit is only meaningful
while nothing can write a `ttl` to the table — from the first audit
until TTL is on and verified.

1. **Pause every writer, then prove the table is quiet.** Keep everything
   paused until step 8.
   - **PostHistory**: pause every writer of the **Post** table — admin /
     editor edits, MCP clients (`create_post` / `update_post` /
     `commit_static_post` via any issued MCP token or local MCP server),
     scripts, imports and integrations — because each Post save makes the
     event-dispatcher Lambda write a revision. Leave `history.retentionDays`
     as it is (see **Don't switch `retentionDays` to 0 for the window**
     below).
   - **KvStore**: pause admin / editor edits (site settings, theme, plugin
     settings) and stop every plugin, script or integration that writes
     KvStore.
   - Custom writers (your own Lambdas, scripts, other apps on the same
     tables) count too. If you cannot pause one, read **Limits** before
     going on.

   Then verify, with all of these — not one alone:
   - **No writes reach the table.** `ConsumedWriteCapacityUnits`
     (`AWS/DynamoDB`, dimension `TableName`) has a `Sum` of 0 for every
     minute since the pause, for the PostHistory or KvStore table (and for
     Post, when preparing PostHistory). This catches writers you did not
     know about. Your own conditional updates in step 3 will show up here
     later — that is expected.
   - **The dispatcher has nothing in flight or pending** (PostHistory).
     Find the event-dispatcher function and its stream mappings:

     ```bash
     aws lambda list-event-source-mappings --region <region> \
       --function-name <event-dispatcher function> \
       --query 'EventSourceMappings[].[EventSourceArn,State,LastProcessingResult,DestinationConfig]'
     ```

     Both mappings (Post and KvStore stream) should be `Enabled`, with
     `LastProcessingResult` `OK` or `No records processed` (the normal
     value for an idle stream). Any other value (for example
     `PROBLEM: ...`) needs investigating first. Neither `State` nor
     `LastProcessingResult` proves the stream is drained on its own — they
     describe the mapping and its most recent poll, not records still
     waiting or being retried — so use them only alongside the metric and
     log checks below. ampless configures no on-failure
     destination — a batch that fails every retry (3 retries, with batch
     bisection) is dropped, not parked in a queue. The events DLQ only
     holds failed plugin-processor messages; processors never write
     PostHistory or KvStore, so it is not a source here.
     For the dispatcher function, CloudWatch `Invocations` and `Errors`
     (`AWS/Lambda`) must be 0, and `ConcurrentExecutions` absent or 0, for
     at least 15 minutes after the last Post write; check its log group for
     errors or retries since the pause. An error in that window means a
     batch was retried or dropped — find out which records it held before
     going on.
   - `IteratorAge` back near 0 is consistent with a drained stream, but it
     is **not proof on its own**: it is only reported when the function is
     invoked, so a missing datapoint looks the same as a drained stream,
     and it says nothing about a batch being retried right now. Use it only
     alongside the checks above.

2. **Audit (read-only).** Find the live table name (`<Model>-<apiId>-NONE`,
   see `aws dynamodb list-tables`), check the current TTL state, and list
   the rows that would be deleted right away — key plus `ttl`, saved to a
   file you keep:

   ```bash
   aws dynamodb describe-time-to-live --region <region> --table-name <live table>

   NOW=$(date +%s)
   aws dynamodb scan --region <region> --table-name <live table> \
     --consistent-read \
     --filter-expression 'attribute_exists(#t) AND #t < :now' \
     --projection-expression 'postHistoryId, #t' \
     --expression-attribute-names '{"#t":"ttl"}' \
     --expression-attribute-values "{\":now\":{\"N\":\"$NOW\"}}" \
     --output json > ttl-audit-1.json
   ```

   For KvStore project `pk, sk, #t` instead of `postHistoryId, #t`. The CLI
   follows `LastEvaluatedKey` for you; `Count` is the number of rows
   already expired and `ScannedCount` the rows read. Use `--select COUNT`
   (instead of the projection) for a quick count. Drop `AND #t < :now` to
   see every row that carries a `ttl`, including ones that will expire
   soon after you enable TTL. A scan reads the whole table and consumes
   read capacity; on large tables run it at a quiet time.

3. **Decide what to keep, and change those rows conditionally.** Every row
   in the audit is deleted once TTL is on unless you remove its `ttl` or
   raise it **before** enabling. Make each change conditional on the row
   still existing and still carrying the `ttl` you saw in the audit:

   ```bash
   aws dynamodb update-item --region <region> --table-name <live table> \
     --key '{"postHistoryId":{"S":"<id>"}}' \
     --update-expression 'REMOVE #t' \
     --condition-expression 'attribute_exists(postHistoryId) AND #t = :seen' \
     --expression-attribute-names '{"#t":"ttl"}' \
     --expression-attribute-values '{":seen":{"N":"<ttl from the audit>"}}'
   ```

   For KvStore use `--key '{"pk":{"S":"<pk>"},"sk":{"S":"<sk>"}}'` and
   `attribute_exists(pk)`. To push the expiry out instead, use
   `--update-expression 'SET #t = :later'` with the same condition and
   `":later":{"N":"<future epoch>"}` added to the values.

   The condition matters: `update-item` without it **creates** a row
   holding only the key if the original was deleted in the meantime, and
   silently overwrites a `ttl` another writer changed after your audit.
   If the call fails with `ConditionalCheckFailedException`, nothing was
   written — re-read the row (`aws dynamodb get-item --consistent-read
   --key ...`) and decide again from what is there now: if it is gone, do
   not recreate it (restore it from PITR if it was needed); if its `ttl`
   changed, a writer is still active — go back to step 1.

   Changing `history.retentionDays` does not fix existing rows: it only
   affects revisions written after the change; existing rows keep the
   `ttl` they were written with. KvStore changes also go through its
   stream like any edit (the dispatcher only acts on `siteconfig` rows).

4. **Confirm PITR is on** for the table — without it (or an on-demand
   backup) a TTL deletion cannot be undone — and note the start of the
   restorable range:

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

5. **Re-audit immediately before deploying.** Repeat the step 1 checks
   (no unexplained writes since the pause apart from your own step 3
   updates, dispatcher idle), then run the step 2 scan again (`ttl-audit-2.json`) with a fresh
   `NOW`. Every row it returns must be one you decided to let go. If a row
   you did not review appears, or a row you fixed is back, a writer is
   still active: stop it and return to step 2. Also add a margin for the
   time until TTL is on — rows that expire between this scan and the end
   of step 7 are deleted too; drop `AND #t < :now` or use
   `NOW=$(( $(date +%s) + 86400 ))` to see what expires in the next day.

6. **Opt in** in `amplify/backend.custom.ts` and deploy, writers still
   paused:

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
   `UpdateTimeToLive`; no table is replaced.

7. **Verify right after the deploy.** `describe-time-to-live` should show
   `ENABLING` or `ENABLED` with `AttributeName` `ttl`. Run the step 2 scan
   once more (`ttl-audit-3.json`): it must return only rows from your
   accepted list (some may already be gone — TTL deletes in the
   background). A row that is not on the list is at risk right now: fix
   it with the conditional update in step 3 at once, and if it was already
   deleted, restore it from PITR (step 4).

8. **Resume the writers.** Re-enable integrations and MCP clients and
   let editors back in. `history.retentionDays` was never changed, so new
   revisions carry their `ttl` as before. From now on, rows are deleted
   when their `ttl` passes — that is the point of turning TTL on. A
   revision's `ttl` is computed from its save time, so with a short
   `retentionDays` a revision written late (a retried stream record) can
   already be past its `ttl` when written.

9. **Monitor.** The CloudWatch metric `TimeToLiveDeletedItemCount`
   (namespace `AWS/DynamoDB`, dimension `TableName`) shows how many rows
   TTL deleted. Expect a burst over the first few days that roughly
   matches your accepted list, then a steady trickle:

   ```bash
   aws cloudwatch get-metric-statistics --region <region> \
     --namespace AWS/DynamoDB --metric-name TimeToLiveDeletedItemCount \
     --dimensions Name=TableName,Value=<live table> \
     --start-time <ISO time you enabled TTL> --end-time <now, ISO> \
     --period 3600 --statistics Sum
   ```

   A sum clearly larger than your accepted list means rows you did not
   review were deleted — compare against a PITR restore to a new table.

**Don't switch `retentionDays` to 0 for the window.** It looks like a way
to stop new `ttl`s without pausing edits, but every revision written while
it is 0 is stored **without** a `ttl`, and restoring the setting later does
not add one: those revisions never expire. If you do it anyway (for
example because edits really cannot pause — see **Limits**), handle those
rows deliberately afterwards: list them with
`attribute_not_exists(#t)` and a `revisedAt` inside the window, and either
accept that they are kept forever or give each one the `ttl` it would have
had (`epoch(revisedAt) + retentionDays * 86400`) with
`--update-expression 'SET #t = :ttl'` and
`--condition-expression 'attribute_exists(postHistoryId) AND attribute_not_exists(#t)'`.
A value already in the past is deleted by TTL straight away. A Post stream
record still being retried when the setting changes is written under
whichever setting the dispatcher has when it runs.

To turn TTL off again, remove the opt-in line and deploy (see the
one-change-per-hour caveat below).

**Limits.**

- This procedure narrows the race; it cannot remove it. DynamoDB has no
  atomic "audit, then enable" operation: TTL is enabled by a deploy, takes
  effect asynchronously, and from then on deletes any row whose `ttl` is
  past — reviewed or not. The guarantee is only as good as the writer
  freeze from step 1 to step 7.
- A strongly consistent scan is consistent per page, not across the whole
  table; two scans show the table at different moments. Only stopped
  writers make them comparable.
- The step 1 checks are evidence, not proof. CloudWatch metrics are
  aggregated per minute and arrive with a delay; a write in the last
  minute, or a writer that ignores the pause, can slip past them.
  `IteratorAge` in particular is not evidence of an idle dispatcher by
  itself.
- If a writer cannot be paused (an external integration, a busy site
  where editing cannot stop), rows it writes with a past or near-past
  `ttl` between the audit and step 7 can be deleted unreviewed. Either
  accept that for that table, change the writer so it stops sending
  `ttl` first (for PostHistory, `retentionDays: 0` — with the permanent
  no-expiry consequence above), or leave TTL off.
- The only way back from an unwanted TTL deletion is a restore (PITR or
  an on-demand backup) followed by a selective copy-back, with the limits
  described in the PITR section.

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

### Normalize stored post publish dates (one-time migration)

AppSync's `AWSDateTime` accepts many spellings of one instant
(`2026-05-01T09:00:00+09:00`, `2026-05-01T00:00Z`, nanoseconds, ...).
Since this release every `createPost` / `updatePost` — admin UI, MCP and
direct GraphQL calls alike — stores `publishedAt` as canonical UTC
(`YYYY-MM-DDTHH:mm:ss.sssZ`) and also writes a derived
`publishedAtSortKey` (`<publishedAt>#<postId>`). A value that is not a
valid date in years 0000–9999 UTC is rejected with `ValidationError`.

Posts saved **before** the upgrade keep their old string until they are
saved again. Such a row can be listed late or out of order, its tag-page
rows keep their old key, and it has no `publishedAtSortKey` (a later
release switches the post list to the index built on it). Rewrite them
once per site with `ampless-migrate-published-at`, after the upgrade is
deployed.

**What the tool guarantees, and what it does not.**

- Each write is one conditional `UpdateItem` that sets only
  `publishedAt` / `publishedAtSortKey`, and only while **those two**
  attributes still hold the values the (strongly consistent) scan read.
  An edit that changed either of them meanwhile makes the write fail; it
  is reported as a conflict and left alone. An edit to any other
  attribute does **not** conflict — the migration write still succeeds
  and does not overwrite that edit, because it sets nothing else.
  `updatedAt` is never changed.
- The writes go through the Post stream like any save. The dispatcher
  sees that only the spelling of `publishedAt` (and
  `publishedAtSortKey`) changed and emits **no** `content.updated` event
  (webhooks and other plugins do not fire) and no PostHistory revision.
  It still refreshes the post's tag-page (PostTag) rows. That refresh
  rebuilds the rows from a strongly consistent read of the post's
  current state, not from the event, and writes each row in a
  transaction that only succeeds while the post still matches that
  state. A draft or deleted post's row therefore cannot be (re)written,
  even when events are processed out of order (the trusted queue is SQS
  standard) or a worker crashes mid-rebuild.
- A dry-run that reports nothing to change does **not** by itself prove
  the migration is complete: a write can be in flight, and the PostTag
  refreshes run asynchronously after the Post writes. Completion is only
  established by the procedure below, with every writer stopped. Running
  the tool while the site is being edited is safe for the data, but its
  report then describes a moving target.

**Procedure**

1. **Deploy the upgrade** and wait for the deploy to finish. The first
   deploy also builds the `byStatusSorted` index on the Post table,
   which can take a while on a large table.
2. **Find the table names** (`Post-<apiId>-NONE`, `PostTag-<apiId>-NONE`)
   in the DynamoDB console, or:

   ```bash
   aws dynamodb list-tables --query "TableNames[?starts_with(@, 'Post')]"
   ```

   With several environments in one account, match `<apiId>` against
   the AppSync API of the branch you are migrating.
3. **Stop every writer** for the duration: no admin or editor sessions
   saving posts, MCP tokens and scripts / API clients paused, no
   deploys. Keep them stopped until step 8.
4. **Dry-run** (the default; strongly consistent reads only):

   ```bash
   pnpm exec ampless-migrate-published-at --table <PostTable> --region <region>
   ```

   It checks that the table and `byStatusSorted` are `ACTIVE` (the index
   no longer backfilling), then lists every post whose `publishedAt`
   would be rewritten (raw value, canonical value, instant) or whose
   `publishedAtSortKey` is missing or stale, and every value it cannot
   parse. Unparseable values are never written: fix them by setting the
   publish date in the admin editor (writers are stopped, so do this
   before step 3 or treat it as a separate pass).
5. **Apply**, after reviewing the dry-run. `--apply` refuses to run
   unless the index is `ACTIVE`:

   ```bash
   pnpm exec ampless-migrate-published-at --table <PostTable> --region <region> --apply
   ```

   Writes are issued one at a time and rate-limited
   (`--max-writes-per-second`, default 10). Re-run the dry-run until it reports nothing to change.
6. **Wait for the event pipeline to drain.** These are signs, not proof
   (step 7 is the check that counts). Look for all of them at the same
   time:
   - the event-dispatcher Lambda's `IteratorAge` metric for the Post
     stream is back to 0 and stays there (CloudWatch → Lambda → the
     dispatcher function). A missing data point is not 0: look at a
     window that covers the whole apply run;
   - the dispatcher's `Errors` metric is 0 over that window, and its log
     group has no `[event-dispatcher]` errors. The Post stream has no
     failure destination: a batch that still fails after its retries is
     **dropped**, so its events never reach the queue — only its errors
     show that it happened;
   - the trusted events queue (`TrustedEventsQueue` in the
     `amplessEvents` stack) shows 0 for `ApproximateNumberOfMessages`,
     `ApproximateNumberOfMessagesNotVisible` and
     `ApproximateNumberOfMessagesDelayed` (these are approximate; read
     them more than once, a minute apart):

     ```bash
     aws sqs get-queue-attributes --queue-url <trusted-queue-url> \
       --attribute-names ApproximateNumberOfMessages \
       ApproximateNumberOfMessagesNotVisible ApproximateNumberOfMessagesDelayed
     ```

   - the dead-letter queue (`EventsDlq`) has no messages from this run.
     If it does, inspect them ([Inspect failed plugin events](#inspect-failed-plugin-events))
     before going on — a failed `post.index.refresh` means a post's tag
     rows were not rebuilt.

   Whatever these show, a lost event can only be caught by step 7.
7. **Check the tag-page index** against the posts (strongly consistent
   reads):

   ```bash
   pnpm exec ampless-migrate-published-at --table <PostTable> \
     --post-tag-table <PostTagTable> --region <region> --check-post-tags
   ```

   It reports PostTag rows that should not exist (for example a draft or
   deleted post, an old key, or an outdated title / excerpt) and rows
   that are missing, and exits non-zero if it finds any. Add `--apply` to
   repair them: each affected post is rebuilt from its current state,
   the same way the event processor does (each row is written only while
   the post still matches the state it was built from). Writes are
   rate-limited one at a time (`--max-writes-per-second`). Repeat until it reports none.
   This also clears stale rows that earlier releases could leave behind.
8. **Resume the writers.** The migration is complete when, with writers
   stopped, step 4 reports nothing to change, step 6 is drained and
   step 7 reports no mismatch.

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
