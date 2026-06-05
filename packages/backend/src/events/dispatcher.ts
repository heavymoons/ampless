import type { DynamoDBStreamHandler, DynamoDBRecord } from 'aws-lambda'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import {
  SQSClient,
  SendMessageBatchCommand,
  type SendMessageBatchRequestEntry,
} from '@aws-sdk/client-sqs'
import {
  detectContentEvents,
  type ContentEventPayload,
  type ContentEventType,
  type PostIndexEventPayload,
} from 'ampless'

// Fail fast at cold-start if required env vars are missing — cheaper than
// debugging cryptic SQS-not-found errors per invocation.
function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`event-dispatcher: missing required env var ${name}`)
  return v
}

const sqs = new SQSClient({})
const TRUSTED_QUEUE_URL = requireEnv('TRUSTED_QUEUE_URL')
const UNTRUSTED_QUEUE_URL = requireEnv('UNTRUSTED_QUEUE_URL')

// DocumentClient for the PostHistory snapshot write. Created once at module
// load so warm invocations reuse the connection (same setup as
// processor-trusted). The table name is read lazily inside the handler so
// tests can stub the env var per-case.
//
// `removeUndefinedValues: true` is REQUIRED here: a snapshot of a draft post
// legitimately has undefined excerpt / publishedAt / metadata / etc., and the
// default DocumentClient marshaller throws "Unsupported type passed: undefined"
// on any such attribute. Stripping them simply omits the attribute, which is
// the desired "copy what's present" behaviour (PostTag puts never hit this
// because every PostTag field is always populated).
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
})

interface RawPost {
  postId?: string
  slug?: string
  title?: string
  status?: 'draft' | 'published'
  publishedAt?: string
  tags?: string[]
}

// Full Post new-image projection used for the revision snapshot. Unlike
// `RawPost` (the body-less SQS projection) this carries the heavy fields —
// body/excerpt/format/metadata — verbatim from the stream record so the
// history row is a faithful copy of the saved version.
interface RawPostFull extends RawPost {
  excerpt?: string
  format?: string
  body?: unknown
  metadata?: unknown
  updatedAt?: string
}

interface RawKvItem {
  pk?: string
  sk?: string
}

type AmplessEventType =
  | ContentEventType
  | 'site.settings.updated'
  | 'post.index.refresh'

interface AmplessEvent {
  type: AmplessEventType
  payload: Record<string, unknown>
  timestamp: string
}

/**
 * The dispatcher is wired to two streams (Post + KvStore). The
 * `eventSourceARN` carries the table name so we can route appropriately.
 *
 *   arn:aws:dynamodb:<region>:<acct>:table/<TableName>/stream/...
 */
function tableNameFromArn(arn: string | undefined): string | null {
  if (!arn) return null
  const match = arn.match(/:table\/([^/]+)/)
  return match ? match[1]! : null
}

function projectPost(raw: RawPost): ContentEventPayload | null {
  if (!raw || !raw.postId || !raw.slug || !raw.title) return null
  return {
    postId: raw.postId,
    slug: raw.slug,
    title: raw.title,
    status: (raw.status ?? 'draft') as ContentEventPayload['status'],
    publishedAt: raw.publishedAt,
    tags: raw.tags,
  }
}

function emitContentEvents(record: DynamoDBRecord, timestamp: string): AmplessEvent[] {
  const oldItem = record.dynamodb?.OldImage
    ? (unmarshall(record.dynamodb.OldImage as never) as RawPost)
    : null
  const newItem = record.dynamodb?.NewImage
    ? (unmarshall(record.dynamodb.NewImage as never) as RawPost)
    : null

  const events: AmplessEvent[] = []

  // post.index.refresh: emitted on every Post mutation so the trusted
  // processor can keep the denormalized PostTag index in sync. Carries
  // both the previous and the next projection so the consumer doesn't
  // need to read DynamoDB to compute the diff. Independent of the
  // content.* events below — those are status-transition signals for
  // plugins, this is an index-maintenance signal.
  const previous = oldItem ? projectPost(oldItem) : null
  const next = newItem ? projectPost(newItem) : null
  if (previous || next) {
    const indexPayload: PostIndexEventPayload = { previous, next }
    events.push({
      type: 'post.index.refresh',
      payload: indexPayload as unknown as Record<string, unknown>,
      timestamp,
    })
  }

  const types = detectContentEvents({
    eventName: record.eventName,
    oldStatus: oldItem?.status,
    newStatus: newItem?.status,
  })
  if (types.length === 0) return events

  const item = newItem ?? oldItem ?? {}
  // Trim to the published event payload — drop body/format etc. to keep
  // SQS messages well under the 256 KiB limit even for large posts.
  const payload = {
    postId: item.postId,
    slug: item.slug,
    title: item.title,
    status: item.status,
    publishedAt: item.publishedAt,
    tags: item.tags,
  }
  for (const type of types) {
    events.push({ type, payload, timestamp })
  }
  return events
}

function emitKvEvents(record: DynamoDBRecord, timestamp: string): AmplessEvent[] {
  const item = (record.dynamodb?.NewImage ?? record.dynamodb?.OldImage)
    ? (unmarshall((record.dynamodb!.NewImage ?? record.dynamodb!.OldImage) as never) as RawKvItem)
    : {}
  const pk = item.pk
  if (!pk) return []
  // Only the `siteconfig` row triggers the site-settings cache rebuild.
  // Cache rows (`cache:*`), plugin state, and other namespaces are
  // intentionally ignored.
  if (pk !== 'siteconfig') return []
  return [
    {
      type: 'site.settings.updated',
      payload: {},
      timestamp,
    },
  ]
}

async function sendBatch(queueUrl: string, entries: SendMessageBatchRequestEntry[]) {
  for (let i = 0; i < entries.length; i += 10) {
    const chunk = entries.slice(i, i + 10)
    await sqs.send(new SendMessageBatchCommand({ QueueUrl: queueUrl, Entries: chunk }))
  }
}

/**
 * Derive the snapshot timestamp for a Post stream record. Prefer the new
 * image's Amplify-managed `updatedAt` (the canonical save time); fall back
 * to the record's `ApproximateCreationDateTime`. NEVER use invocation time
 * (`new Date()`) — at-least-once stream re-delivery would change the value
 * and break the deterministic `${postId}#${revisedAt}` idempotency key.
 */
function revisedAtForRecord(record: DynamoDBRecord, post: RawPostFull): string | null {
  if (post.updatedAt) return post.updatedAt
  const approx = record.dynamodb?.ApproximateCreationDateTime
  if (typeof approx === 'number') {
    // Stream records report seconds (epoch). Convert to an ISO string so the
    // value matches the AWSDateTime shape Amplify writes for `updatedAt`.
    return new Date(approx * 1000).toISOString()
  }
  return null
}

/**
 * Write one PostHistory revision snapshot for a Post INSERT/MODIFY record.
 *
 * Resilience contract: this MUST NOT throw out of the handler. The dispatcher
 * is on a DynamoDB stream wired to two SQS fan-out queues; if it throws, the
 * whole batch is reprocessed and content events are re-emitted, double-firing
 * plugin hooks. So every failure here is logged and swallowed — a missed
 * revision is strictly less bad than duplicate content events.
 *
 * Idempotency: the row id is the deterministic `${postId}#${revisedAt}` and
 * the put is guarded by `attribute_not_exists(postHistoryId)`, so stream
 * re-delivery of the same save is a no-op (logged at debug level).
 */
async function writePostHistory(
  record: DynamoDBRecord,
  tableName: string,
  historyRetentionDays: number
): Promise<void> {
  try {
    // REMOVE has no new image — nothing to snapshot.
    if (record.eventName !== 'INSERT' && record.eventName !== 'MODIFY') return
    if (!record.dynamodb?.NewImage) return

    const post = unmarshall(record.dynamodb.NewImage as never) as RawPostFull
    if (!post.postId) {
      console.error('[event-dispatcher] PostHistory: new image has no postId; skipping snapshot')
      return
    }

    const revisedAt = revisedAtForRecord(record, post)
    if (!revisedAt) {
      console.error(
        `[event-dispatcher] PostHistory: postId=${post.postId} has no updatedAt and no ApproximateCreationDateTime; skipping snapshot`
      )
      return
    }

    const postHistoryId = `${post.postId}#${revisedAt}`

    // Amplify Gen 2 auto-generates non-nullable createdAt/updatedAt
    // (AWSDateTime!) on every model; the AppSync read resolver returns null
    // for the whole row if either is absent (real bug from Phase 6a — see
    // plugin-secret-handler.ts). Set both deterministically to revisedAt so
    // re-delivery produces the identical item.
    const item: Record<string, unknown> = {
      postHistoryId,
      postId: post.postId,
      revisedAt,
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      format: post.format,
      // body stays the AWSJSON string form, same as Post storage.
      body: post.body,
      status: post.status,
      publishedAt: post.publishedAt,
      tags: post.tags,
      metadata: post.metadata,
      createdAt: revisedAt,
      updatedAt: revisedAt,
    }

    // Only attach ttl when retention is enabled. Base is revisedAt (the save
    // time), NOT now — so re-delivery yields the same expiry and the row is
    // byte-identical. 0/undefined retention = no ttl attribute = keep forever.
    if (historyRetentionDays > 0) {
      item.ttl = Math.floor(new Date(revisedAt).getTime() / 1000) + historyRetentionDays * 86400
    }

    await ddb.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(postHistoryId)',
      })
    )
  } catch (err) {
    // ConditionalCheckFailedException = idempotent re-delivery; this snapshot
    // already exists. Treat as a no-op (debug log only).
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
      console.debug(
        '[event-dispatcher] PostHistory: snapshot already exists (re-delivery), skipping'
      )
      return
    }
    // Any other failure: log and continue. Do NOT rethrow — see the
    // resilience contract in this function's doc comment.
    console.error('[event-dispatcher] PostHistory: snapshot write failed', err)
  }
}

export interface CreateDispatcherHandlerOpts {
  /**
   * Days to retain each PostHistory revision before DynamoDB TTL deletes it.
   * `0` (the default) means keep every revision forever — no `ttl` attribute
   * is written. Supplied by the template shell from
   * `cms.config.history?.retentionDays`.
   */
  historyRetentionDays?: number
}

/**
 * Build the DynamoDB-stream → SQS-fanout dispatcher. Wired to both the Post
 * and KvStore tables; routes content events to the trusted+untrusted queues
 * and site-settings updates likewise. trust_level isolation is enforced by
 * the downstream Lambdas' IAM roles, not by message routing here.
 *
 * In addition, for each Post INSERT/MODIFY it writes one PostHistory revision
 * snapshot (best-effort, never throws — see `writePostHistory`).
 *
 * The template's thin shell `amplify/events/dispatcher/handler.ts` calls this
 * with `historyRetentionDays` from `cms.config`.
 */
export function createDispatcherHandler(
  opts: CreateDispatcherHandlerOpts
): DynamoDBStreamHandler {
  const historyRetentionDays = opts.historyRetentionDays ?? 0

  return async (event) => {
    const messages: AmplessEvent[] = []
    const timestamp = new Date().toISOString()

    // Read lazily (not at module load) so an un-upgraded project whose
    // backend hasn't wired the env var yet still dispatches events — it just
    // skips history writes. Also lets tests set/unset per-case.
    const historyTable = process.env.AMPLESS_POST_HISTORY_TABLE
    let warnedNoHistoryTable = false

    for (const record of event.Records) {
      const tableName = tableNameFromArn(record.eventSourceARN)
      // The table name carries an Amplify suffix (e.g. `Post-<api-id>-NONE`)
      // but always starts with the schema model name.
      if (tableName && tableName.startsWith('Post-')) {
        messages.push(...emitContentEvents(record, timestamp))
        if (historyTable) {
          await writePostHistory(record, historyTable, historyRetentionDays)
        } else if (!warnedNoHistoryTable) {
          console.log(
            '[event-dispatcher] AMPLESS_POST_HISTORY_TABLE not set; skipping PostHistory snapshots'
          )
          warnedNoHistoryTable = true
        }
      } else if (tableName && tableName.startsWith('KvStore-')) {
        messages.push(...emitKvEvents(record, timestamp))
      }
    }

    if (messages.length === 0) return

    const entries: SendMessageBatchRequestEntry[] = messages.map((m, i) => ({
      Id: `msg-${i}`,
      MessageBody: JSON.stringify(m),
    }))

    // Fan-out: every event goes to both queues, the consumer Lambda decides
    // which plugins react. trust_level isolation is enforced by the Lambdas'
    // own IAM roles, not by message routing.
    await Promise.all([
      sendBatch(TRUSTED_QUEUE_URL, entries),
      sendBatch(UNTRUSTED_QUEUE_URL, entries),
    ])
  }
}

/**
 * Backward-compatible default handler. Existing template shells re-export
 * `{ handler }` from this subpath and un-upgraded projects keep working with
 * `historyRetentionDays: 0` (revisions kept forever, no ttl). New shells call
 * `createDispatcherHandler({ historyRetentionDays })` directly.
 */
export const handler: DynamoDBStreamHandler = createDispatcherHandler({ historyRetentionDays: 0 })
