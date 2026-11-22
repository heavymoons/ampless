/**
 * One-off backfill for #406: rewrite every Post row's `publishedAt` to the
 * canonical UTC form and set the derived `publishedAtSortKey`
 * (`<canonical>#<postId>`) that the AppSync write path now maintains for new
 * writes.
 *
 * Safety properties:
 *   - Dry-run by default; nothing is written unless `apply` is true.
 *   - The Scan is strongly consistent (`ConsistentRead: true`), so it sees
 *     every write acknowledged before the page was read.
 *   - Each write is a conditional UpdateItem guarded ONLY on the two
 *     attributes it sets: `publishedAt = :raw` and the sortKey unchanged (or
 *     absent). An edit that changed either of those since the scan makes
 *     the write fail; it is reported as a conflict and picked up by a
 *     re-run. An edit to any other attribute (title, body, status, tags,
 *     ...) does NOT conflict and is not overwritten either, because the
 *     update SETs only `publishedAt` / `publishedAtSortKey`.
 *   - `updatedAt` is left alone on purpose: together with the dispatcher's
 *     representation-only check this keeps the rewrite from emitting
 *     content.* events or a PostHistory revision. It still emits
 *     `post.index.refresh`, whose PostTag rebuild reads the current Post
 *     (see events/posttag-sync.ts), so the order in which those events are
 *     processed does not matter.
 *   - Idempotent: a second run classifies every migrated row as `ok`.
 *
 * A dry-run that reports nothing to change does not by itself prove the
 * migration is complete: writers may still be saving posts, and the
 * PostTag rebuilds its writes trigger run asynchronously. Completion is
 * confirmed under the RUNBOOK procedure — writers stopped, apply, a zero
 * dry-run, the stream / trusted queue / DLQ drained, then
 * `--check-post-tags` reporting zero mismatches (./post-tags-check.ts).
 *
 * Before `apply`, `checkPublishedAtPreflight` verifies with DescribeTable
 * that the table and its `byStatusSorted` GSI are ACTIVE and the GSI is no
 * longer backfilling.
 *
 * Values `parseAwsDateTime` rejects (including a lowercase `z` zone, or an
 * instant outside UTC years 0000-9999, which the AppSync write path also
 * rejects) are reported as `unparseable` and never written; fix them by
 * re-saving the post with a valid date, then re-run.
 */
import { DescribeTableCommand, type DescribeTableCommandOutput } from '@aws-sdk/client-dynamodb'
import { ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { canonicalizeAwsDateTime, parseAwsDateTime } from 'ampless'
import { createWriteLimiter } from './write-limiter.js'

/** The projected Post attributes the migration reads. */
export interface PublishedAtMigrationItem {
  postId: string
  status?: unknown
  publishedAt?: unknown
  publishedAtSortKey?: unknown
}

export type PublishedAtMigrationPlan =
  | { kind: 'ok' }
  | {
      kind: 'rewrite'
      raw: string
      canonical: string
      sortKey: string
      /** Whether the scanned row had a `publishedAtSortKey` attribute. */
      hadSortKey: boolean
      oldSortKey?: unknown
    }
  | {
      kind: 'removeSortKey'
      /** `absent` = no publishedAt attribute; `null` = a DynamoDB NULL. */
      publishedAt: 'absent' | 'null'
      oldSortKey: unknown
    }
  | { kind: 'unparseable'; raw: unknown }

/** Decide what (if anything) a single scanned row needs. Pure. */
export function planPublishedAtMigration(item: PublishedAtMigrationItem): PublishedAtMigrationPlan {
  const hadSortKey = item.publishedAtSortKey !== undefined
  const raw = item.publishedAt

  if (raw === undefined || raw === null) {
    if (!hadSortKey) return { kind: 'ok' }
    return {
      kind: 'removeSortKey',
      publishedAt: raw === null ? 'null' : 'absent',
      oldSortKey: item.publishedAtSortKey,
    }
  }

  const canonical = canonicalizeAwsDateTime(raw)
  if (typeof raw !== 'string' || canonical === undefined) return { kind: 'unparseable', raw }

  const sortKey = `${canonical}#${item.postId}`
  if (raw === canonical && item.publishedAtSortKey === sortKey) return { kind: 'ok' }
  return {
    kind: 'rewrite',
    raw,
    canonical,
    sortKey,
    hadSortKey,
    ...(hadSortKey ? { oldSortKey: item.publishedAtSortKey } : {}),
  }
}

/** Build the conditional UpdateItem input for a planned change. */
export function buildPublishedAtUpdate(
  tableName: string,
  postId: string,
  plan: Extract<PublishedAtMigrationPlan, { kind: 'rewrite' | 'removeSortKey' }>
): ConstructorParameters<typeof UpdateCommand>[0] {
  if (plan.kind === 'rewrite') {
    return {
      TableName: tableName,
      Key: { postId },
      UpdateExpression: 'SET #pa = :canonical, #sk = :sortKey',
      ConditionExpression: plan.hadSortKey
        ? '#pa = :raw AND #sk = :oldSortKey'
        : '#pa = :raw AND attribute_not_exists(#sk)',
      ExpressionAttributeNames: { '#pa': 'publishedAt', '#sk': 'publishedAtSortKey' },
      ExpressionAttributeValues: {
        ':canonical': plan.canonical,
        ':sortKey': plan.sortKey,
        ':raw': plan.raw,
        ...(plan.hadSortKey ? { ':oldSortKey': plan.oldSortKey } : {}),
      },
    }
  }
  return {
    TableName: tableName,
    Key: { postId },
    UpdateExpression: 'REMOVE #sk',
    ConditionExpression:
      plan.publishedAt === 'null'
        ? 'attribute_type(#pa, :nullType) AND #sk = :oldSortKey'
        : 'attribute_not_exists(#pa) AND #sk = :oldSortKey',
    ExpressionAttributeNames: { '#pa': 'publishedAt', '#sk': 'publishedAtSortKey' },
    ExpressionAttributeValues: {
      ':oldSortKey': plan.oldSortKey,
      ...(plan.publishedAt === 'null' ? { ':nullType': 'NULL' } : {}),
    },
  }
}

/** Minimal DynamoDBDocumentClient surface the runner needs (mockable). */
export interface MigrationClient {
  send(command: ScanCommand | UpdateCommand): Promise<unknown>
}

export interface RunPublishedAtMigrationOpts {
  client: MigrationClient
  /** The physical Post table name (e.g. `Post-<apiId>-NONE`). */
  tableName: string
  /** Write changes. When false (default) only reports what would change. */
  apply?: boolean
  /**
   * Upper bound on UpdateItem calls per second, enforced before each call
   * (no burst). Default 10.
   */
  maxWritesPerSecond?: number
  /** Scan page size (DynamoDB `Limit`). Default: DynamoDB's 1 MB pages. */
  pageSize?: number
  /** Progress / report lines. Default `console.log`. */
  log?: (line: string) => void
  /** Injectable for tests. Default: setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>
  /** Injectable clock (ms) for tests. Default `Date.now`. */
  now?: () => number
}

export interface PublishedAtMigrationSummary {
  apply: boolean
  scanned: number
  ok: number
  /** Rows needing a publishedAt / sortKey rewrite (planned, both modes). */
  toRewrite: number
  /** Rows with a stray sortKey and no publishedAt (planned, both modes). */
  toRemoveSortKey: number
  rewritten: number
  sortKeyRemoved: number
  unparseable: Array<{ postId: string; status: unknown; raw: unknown }>
  /**
   * Condition failed: publishedAt / publishedAtSortKey changed after the scan
   * (re-run picks it up). Edits to other attributes never land here.
   */
  conflicts: Array<{ postId: string; action: 'rewrite' | 'removeSortKey' }>
  failed: Array<{ postId: string | null; action: string; error: string }>
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`
  return String(err)
}

/**
 * Scan the Post table and plan (dry-run) or apply the publishedAt migration.
 * Per-row write failures are logged and recorded in the summary; the scan
 * continues. A Scan failure is thrown — the run cannot continue without it.
 */
export async function runPublishedAtMigration(
  opts: RunPublishedAtMigrationOpts
): Promise<PublishedAtMigrationSummary> {
  const apply = opts.apply ?? false
  const limiter = createWriteLimiter({
    maxWritesPerSecond: opts.maxWritesPerSecond ?? 10,
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
  })
  const log = opts.log ?? ((line: string) => console.log(line))

  const summary: PublishedAtMigrationSummary = {
    apply,
    scanned: 0,
    ok: 0,
    toRewrite: 0,
    toRemoveSortKey: 0,
    rewritten: 0,
    sortKeyRemoved: 0,
    unparseable: [],
    conflicts: [],
    failed: [],
  }

  let exclusiveStartKey: Record<string, unknown> | undefined
  do {
    const page = (await opts.client.send(
      new ScanCommand({
        TableName: opts.tableName,
        // Strong reads: an eventually consistent page could miss a write
        // acknowledged just before it, so a zero dry-run would mean less.
        ConsistentRead: true,
        // `status` is a DynamoDB reserved word, so every name goes through
        // ExpressionAttributeNames.
        ProjectionExpression: '#id, #pa, #sk, #st',
        ExpressionAttributeNames: {
          '#id': 'postId',
          '#pa': 'publishedAt',
          '#sk': 'publishedAtSortKey',
          '#st': 'status',
        },
        ...(opts.pageSize !== undefined ? { Limit: opts.pageSize } : {}),
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      })
    )) as { Items?: Array<Record<string, unknown>>; LastEvaluatedKey?: Record<string, unknown> }

    for (const raw of page.Items ?? []) {
      summary.scanned++
      if (typeof raw.postId !== 'string' || raw.postId === '') {
        console.error('[migrate-published-at] scanned row has no string postId; skipping', raw)
        summary.failed.push({ postId: null, action: 'plan', error: 'missing postId' })
        continue
      }
      const item = raw as unknown as PublishedAtMigrationItem
      const postId = item.postId
      const plan = planPublishedAtMigration(item)

      if (plan.kind === 'ok') {
        summary.ok++
        continue
      }
      if (plan.kind === 'unparseable') {
        summary.unparseable.push({ postId, status: item.status, raw: plan.raw })
        log(
          `UNPARSEABLE postId=${postId} status=${String(item.status)} publishedAt=${JSON.stringify(plan.raw)} (not written; re-save the post with a valid date)`
        )
        continue
      }

      if (plan.kind === 'rewrite') {
        summary.toRewrite++
        const instant = new Date(parseAwsDateTime(plan.raw)!).toISOString()
        log(
          `${apply ? 'REWRITE' : 'WOULD REWRITE'} postId=${postId} status=${String(item.status)} raw=${plan.raw} canonical=${plan.canonical} rawInstant=${instant} sortKey=${plan.sortKey}${plan.hadSortKey ? ` oldSortKey=${String(plan.oldSortKey)}` : ''}`
        )
      } else {
        summary.toRemoveSortKey++
        log(
          `${apply ? 'REMOVE SORTKEY' : 'WOULD REMOVE SORTKEY'} postId=${postId} status=${String(item.status)} publishedAt=${plan.publishedAt} oldSortKey=${String(plan.oldSortKey)}`
        )
      }
      if (!apply) continue

      await limiter.acquire()
      try {
        await opts.client.send(
          new UpdateCommand(buildPublishedAtUpdate(opts.tableName, postId, plan))
        )
        if (plan.kind === 'rewrite') summary.rewritten++
        else summary.sortKeyRemoved++
      } catch (err) {
        if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
          // publishedAt or publishedAtSortKey changed after the scan (an
          // editor saved a new date). Their write went through the AppSync
          // pipeline and is canonical already, or a re-run will pick it up.
          summary.conflicts.push({ postId, action: plan.kind })
          log(`CONFLICT postId=${postId}: row changed since the scan; skipped (re-run to recheck)`)
        } else {
          console.error(`[migrate-published-at] ${plan.kind} failed for postId=${postId}`, err)
          summary.failed.push({ postId, action: plan.kind, error: errorMessage(err) })
        }
      }
    }

    exclusiveStartKey = page.LastEvaluatedKey
  } while (exclusiveStartKey)

  return summary
}

// ---------------------------------------------------------------------------
// Preflight: table + byStatusSorted GSI readiness (DescribeTable)
// ---------------------------------------------------------------------------

export const SORTED_INDEX_NAME = 'byStatusSorted'

/** Minimal DynamoDBClient surface the preflight needs (mockable). */
export interface PreflightClient {
  send(command: DescribeTableCommand): Promise<DescribeTableCommandOutput>
}

export interface PublishedAtPreflight {
  ok: boolean
  tableStatus: string | null
  index: { name: string; status: string | null; backfilling: boolean } | null
  /** Human-readable reasons `ok` is false (empty when ok). */
  problems: string[]
}

/**
 * Check, via DescribeTable, that the Post table is ACTIVE and its
 * `byStatusSorted` GSI exists, is ACTIVE and is not backfilling. The
 * migration's writes populate that index, so applying while it is still
 * being created or backfilled is refused. A DescribeTable failure is thrown.
 */
export async function checkPublishedAtPreflight(
  client: PreflightClient,
  tableName: string
): Promise<PublishedAtPreflight> {
  const res = await client.send(new DescribeTableCommand({ TableName: tableName }))
  const table = res.Table
  const problems: string[] = []
  const tableStatus = table?.TableStatus ?? null
  if (tableStatus !== 'ACTIVE') {
    problems.push(`table ${tableName} status is ${tableStatus ?? 'unknown'} (need ACTIVE)`)
  }
  const gsi = (table?.GlobalSecondaryIndexes ?? []).find((g) => g.IndexName === SORTED_INDEX_NAME)
  let index: PublishedAtPreflight['index'] = null
  if (!gsi) {
    problems.push(
      `GSI ${SORTED_INDEX_NAME} not found on ${tableName} (deploy this release before migrating)`
    )
  } else {
    index = {
      name: SORTED_INDEX_NAME,
      status: gsi.IndexStatus ?? null,
      backfilling: gsi.Backfilling === true,
    }
    if (index.status !== 'ACTIVE') {
      problems.push(`GSI ${SORTED_INDEX_NAME} status is ${index.status ?? 'unknown'} (need ACTIVE)`)
    }
    if (index.backfilling) problems.push(`GSI ${SORTED_INDEX_NAME} is still backfilling`)
  }
  return { ok: problems.length === 0, tableStatus, index, problems }
}
