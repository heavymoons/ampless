> 日本語版: [05-event-system.ja.md](./05-event-system.ja.md)
> 
## 5. Event System

### Design Philosophy

Provide hooks on CMS lifecycle events as integration points for plugins and external services.
Concrete functionality such as social media posting is not built into the core; instead, hooks + webhooks delegate to external systems.

`after` hooks use DynamoDB Streams + SQS to reliably capture events regardless of which path triggered the change (admin UI / MCP / REST API).

### Architecture

```
[Synchronous: before hooks]
  Executed inside the Core library. Can block processing.

  API Route / MCP / REST API
    → Core: execute before hook (validation, etc.)
    → Core: write to DynamoDB

[Asynchronous: after hooks]
  Executed asynchronously via DynamoDB Streams → SQS.

  DynamoDB Stream
    → event-dispatcher Lambda (determine event type, enqueue to SQS)
      → SQS: ampless-events
        → event-processor Lambda
            ├── Execute after hooks
            ├── Send webhooks
            ├── Regenerate S3 cache / RSS
            └── On failure → DLQ (ampless-events-dlq)
```

### Why SQS Is Used as an Intermediary

| Consideration | Stream → direct execution | Stream → SQS → execution |
|--------------|--------------------------|--------------------------|
| Retry control | All records reprocessed | Retry per message |
| Failure handling | Stream DLQ has limitations | Easily quarantine failed messages in SQS DLQ |
| Throughput control | Batch size only | Fine-grained control via concurrency and visibility timeout |
| Failure isolation | One failure retries the entire batch | Only the failed message is retried |

### Event List

#### Content Events

| Event | Trigger |
|-------|---------|
| `content.created` | Post created |
| `content.updated` | Post updated |
| `content.published` | Draft → published |
| `content.unpublished` | Published → unpublished |
| `content.deleted` | Post deleted |
| `content.scheduled` | Scheduled publish set |

#### Media Events

| Event | Trigger |
|-------|---------|
| `media.uploaded` | Media uploaded |
| `media.deleted` | Media deleted |

#### Site / User Events

| Event | Trigger |
|-------|---------|
| `site.deployed` | Deployment complete |
| `site.settings.updated` | Site settings changed |
| `user.login` | User login |
| `user.created` | User created |

#### Index-maintenance Events

| Event | Trigger | Payload |
|-------|---------|---------|
| `post.index.refresh` | Any Post mutation (INSERT / MODIFY / REMOVE) | `{ previous, next }` content-event projections — both populated on MODIFY, `previous` null on INSERT, `next` null on REMOVE |

`post.index.refresh` is consumed by the built-in `rebuildPostTagsForPost` handler in the trusted processor: it computes the (tag × `publishedAt#postId`) diff between the two projections and applies it to the denormalized `PostTag` table via direct DynamoDB Put / Delete. Centralising this in the event pipeline means write paths (admin, MCP, future REST clients) don't need to call a sync helper — every Post write that hits DynamoDB automatically triggers the corresponding PostTag refresh over the Stream. The same event is also exposed to user plugins for custom index maintenance (search, sitemaps with per-tag pages, etc.).

### Hook Types

| Hook | Execution | Location | Use cases |
|------|-----------|----------|-----------|
| `before:*` | Synchronous. Returning `false` blocks processing | Inside Core library | Validation, approval workflows, banned word checks |
| `after:*` | Asynchronous. Failure does not roll back the original operation | event-processor Lambda (via SQS) | Webhooks, social media posts, RSS regeneration, cache purge |

### event-dispatcher Lambda

Called from the DynamoDB Stream; determines the event type and enqueues it to SQS. Kept lightweight.

```typescript
export async function handler(event: DynamoDBStreamEvent) {
  const messages = []

  for (const record of event.Records) {
    const oldItem = record.dynamodb.OldImage ? unmarshall(record.dynamodb.OldImage) : null
    const newItem = record.dynamodb.NewImage ? unmarshall(record.dynamodb.NewImage) : null

    const eventType = detectEventType(record.eventName, oldItem, newItem)
    if (eventType) {
      messages.push({
        type: eventType,
        payload: newItem ?? oldItem,
        timestamp: record.dynamodb.ApproximateCreationDateTime,
      })
    }
  }

  await sqs.sendMessageBatch({
    QueueUrl: QUEUE_URL,
    Entries: messages.map((msg, i) => ({
      Id: String(i),
      MessageBody: JSON.stringify(msg),
    }))
  })
}

function detectEventType(eventName: string, oldItem: any, newItem: any): string | null {
  if (eventName === 'INSERT') return 'content.created'
  if (eventName === 'REMOVE') return 'content.deleted'
  if (eventName === 'MODIFY') {
    if (oldItem?.status !== 'published' && newItem?.status === 'published') return 'content.published'
    if (oldItem?.status === 'published' && newItem?.status !== 'published') return 'content.unpublished'
    return 'content.updated'
  }
  return null
}
```

### before Hooks in the Core Library

```typescript
// packages/ampless/src/core.ts
async function publishPost(auth: AuthContext, siteId: string, postId: string) {
  // 1. before hook (synchronous, can block)
  const result = await runBeforeHooks('content.published', post)
  if (!result.ok) throw new Error(result.reason)

  // 2. Write to DynamoDB
  await dynamodb.update({ status: 'published', ... })

  // 3. No after hook here — DynamoDB Streams → SQS picks it up
}
```

### Webhook Configuration

```typescript
// cms.config.ts
export default defineConfig({
  hooks: {
    'before:content.published': async (event) => {
      if (event.content.title.includes('banned-word')) {
        return { ok: false, reason: 'Title contains a banned word' }
      }
      return { ok: true }
    }
  },
  webhooks: [
    {
      events: ['content.published', 'content.updated'],
      url: 'https://hooks.zapier.com/...',
    }
  ]
})
```

The event-processor Lambda sends webhooks when it receives SQS messages.

```
Post published → DynamoDB Stream → SQS → event-processor
  → Webhook POST → Zapier → post to X
                  → n8n → post to Bluesky
                  → Lambda → LINE notification
```

### Future Extensions

Inserting an SNS topic between event-dispatcher and SQS enables delivery to multiple queues:

```
event-dispatcher → SNS (ampless-events topic)
  ├── SQS: hooks-queue     → hook/webhook processing
  ├── SQS: cache-queue     → S3 cache regeneration
  └── SQS: analytics-queue → analytics (plugin)
```

A single SQS queue is sufficient for v0.1. SNS can be added when needed.

### v1 Policy
- v0.1: DynamoDB Streams + SQS + `content.published` after hook + webhook
- v0.2: before hooks, media events
- v1.0: Full event coverage, SQS fan-out via SNS

---
