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

// DynamoDB rows can have any of these missing post-unmarshall, so the type
// here is intentionally looser than ampless' ContentEventPayload.
interface RawPost {
  siteId?: string
  postId?: string
  slug?: string
  title?: string
  status?: 'draft' | 'published'
  publishedAt?: string
  tags?: string[]
}

type EventType = ContentEventType

interface AmplessEvent {
  type: EventType
  payload: RawPost
  timestamp: string
}

// Decide which CMS-level events a Stream record represents. A single
// Stream record can produce 0..2 events (e.g. INSERT of a published post
// emits both `content.created` and `content.published`).
function detectEvents(record: DynamoDBRecord): EventType[] {
  const oldItem = record.dynamodb?.OldImage
    ? (unmarshall(record.dynamodb.OldImage as never) as RawPost)
    : null
  const newItem = record.dynamodb?.NewImage
    ? (unmarshall(record.dynamodb.NewImage as never) as RawPost)
    : null

  return detectContentEvents({
    eventName: record.eventName,
    oldStatus: oldItem?.status,
    newStatus: newItem?.status,
  })
}

function extractPayload(record: DynamoDBRecord): RawPost {
  const newItem = record.dynamodb?.NewImage
    ? (unmarshall(record.dynamodb.NewImage as never) as RawPost)
    : null
  const oldItem = record.dynamodb?.OldImage
    ? (unmarshall(record.dynamodb.OldImage as never) as RawPost)
    : null
  const item = newItem ?? oldItem ?? {}
  // Trim to the published event payload — drop body/format etc. to keep
  // SQS messages well under the 256 KiB limit even for large posts.
  return {
    siteId: item.siteId,
    postId: item.postId,
    slug: item.slug,
    title: item.title,
    status: item.status,
    publishedAt: item.publishedAt,
    tags: item.tags,
  }
}

async function sendBatch(queueUrl: string, entries: SendMessageBatchRequestEntry[]) {
  for (let i = 0; i < entries.length; i += 10) {
    const chunk = entries.slice(i, i + 10)
    await sqs.send(new SendMessageBatchCommand({ QueueUrl: queueUrl, Entries: chunk }))
  }
}

export const handler: DynamoDBStreamHandler = async (event) => {
  const messages: AmplessEvent[] = []
  const timestamp = new Date().toISOString()

  for (const record of event.Records) {
    const types = detectEvents(record)
    if (types.length === 0) continue
    const payload = extractPayload(record)
    for (const type of types) {
      messages.push({ type, payload, timestamp })
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
