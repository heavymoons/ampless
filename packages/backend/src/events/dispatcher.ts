import type { DynamoDBStreamHandler, DynamoDBRecord } from 'aws-lambda'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import {
  SQSClient,
  SendMessageBatchCommand,
  type SendMessageBatchRequestEntry,
} from '@aws-sdk/client-sqs'
import { detectContentEvents, type ContentEventType } from 'ampless'

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

interface RawPost {
  siteId?: string
  postId?: string
  slug?: string
  title?: string
  status?: 'draft' | 'published'
  publishedAt?: string
  tags?: string[]
}

interface RawKvItem {
  pk?: string
  sk?: string
}

type AmplessEventType = ContentEventType | 'site.settings.updated'

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

function emitContentEvents(record: DynamoDBRecord, timestamp: string): AmplessEvent[] {
  const oldItem = record.dynamodb?.OldImage
    ? (unmarshall(record.dynamodb.OldImage as never) as RawPost)
    : null
  const newItem = record.dynamodb?.NewImage
    ? (unmarshall(record.dynamodb.NewImage as never) as RawPost)
    : null

  const types = detectContentEvents({
    eventName: record.eventName,
    oldStatus: oldItem?.status,
    newStatus: newItem?.status,
  })
  if (types.length === 0) return []

  const item = newItem ?? oldItem ?? {}
  // Trim to the published event payload — drop body/format etc. to keep
  // SQS messages well under the 256 KiB limit even for large posts.
  const payload = {
    siteId: item.siteId,
    postId: item.postId,
    slug: item.slug,
    title: item.title,
    status: item.status,
    publishedAt: item.publishedAt,
    tags: item.tags,
  }
  return types.map((type) => ({ type, payload, timestamp }))
}

function emitKvEvents(record: DynamoDBRecord, timestamp: string): AmplessEvent[] {
  const item = (record.dynamodb?.NewImage ?? record.dynamodb?.OldImage)
    ? (unmarshall((record.dynamodb!.NewImage ?? record.dynamodb!.OldImage) as never) as RawKvItem)
    : {}
  const pk = item.pk
  if (!pk) return []
  // Only `siteconfig:{siteId}` rows trigger the site-settings cache
  // rebuild. Cache rows (`cache:*`), plugin state, and other namespaces
  // are intentionally ignored.
  if (!pk.startsWith('siteconfig:')) return []
  const siteId = pk.slice('siteconfig:'.length)
  if (!siteId) return []
  return [
    {
      type: 'site.settings.updated',
      payload: { siteId },
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
 * DynamoDB-stream → SQS-fanout dispatcher. Wired to both the Post and
 * KvStore tables; routes content events to the trusted+untrusted
 * queues and site-settings updates likewise. trust_level isolation
 * is enforced by the downstream Lambdas' IAM roles, not by message
 * routing here.
 *
 * Re-exported by the template's thin shell
 * `amplify/events/dispatcher/handler.ts`.
 */
export const handler: DynamoDBStreamHandler = async (event) => {
  const messages: AmplessEvent[] = []
  const timestamp = new Date().toISOString()

  for (const record of event.Records) {
    const tableName = tableNameFromArn(record.eventSourceARN)
    // The table name carries an Amplify suffix (e.g. `Post-<api-id>-NONE`)
    // but always starts with the schema model name.
    if (tableName && tableName.startsWith('Post-')) {
      messages.push(...emitContentEvents(record, timestamp))
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
