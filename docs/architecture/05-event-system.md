> 日本語版: [05-event-system.ja.md](./05-event-system.ja.md)
> 
## 5. Event System

### Design Philosophy

CMS lifecycle events are emitted as an integration point for plugins and external services. Concrete functionality (social posting, RSS, analytics) is not built into core — plugins and webhooks delegate to external systems.

`after` events flow over **DynamoDB Streams → SQS → processor Lambdas**. This guarantees an event for every write that reaches the table, regardless of which client path triggered it (admin UI, MCP, future REST). There is no EventBridge in this pipeline; the dispatcher Lambda is wired directly to the Streams.

### Architecture

```
DynamoDB Stream (Post)         →┐
DynamoDB Stream (KvStore)      →┤
                                ├→ event-dispatcher Lambda
                                │     │
                                │     ├→ SQS: TrustedEventsQueue   → processor-trusted   Lambda
                                │     └→ SQS: UntrustedEventsQueue → processor-untrusted Lambda
                                │              │                            │
                                │              └→ shared EventsDlq (DLQ)   ←┘
                                │   (maxReceiveCount: 3, retention: 14 days)
```

Wiring lives in [`packages/backend/src/backend.ts`](../../packages/backend/src/backend.ts#L177).

Key properties:

- **Fan-out, not routing.** Every event goes to **both** queues. Trust-level isolation is enforced by the **IAM execution role** of each processor Lambda, not by selecting which queue an event lands in. A trusted plugin reading posts is allowed because its Lambda has `dynamodb:Query` on the Post table; an untrusted plugin can't, because its Lambda has zero AWS data permissions.
- **One shared DLQ.** Failures retry up to 3 times before landing in `EventsDlq` (14-day retention). The two main queues differ in visibility timeout (trusted 120 s, untrusted 60 s) reflecting their expected work.
- **Two sources.** The dispatcher consumes both the Post stream (content events) and the KvStore stream (filtered to `pk='siteconfig'` only). Other KvStore writes — cache rows, plugin state — are ignored.

`before` hooks are reserved in the type system but **not yet wired** to plugins. The `definePlugin` shape accepts them, but no hook fires before a write currently.

### Why SQS Sits Between the Stream and the Processors

| Consideration | Stream → direct execution | Stream → SQS → execution |
|--------------|--------------------------|--------------------------|
| Retry control | All records in the batch reprocessed | Per-message retry |
| Failure isolation | One failure retries the whole batch | Only the failed message retries |
| Failure quarantine | Stream DLQ has limitations | SQS DLQ is first-class |
| Concurrency control | Batch size only | SQS concurrency + visibility timeout |
| Trust-level split | Requires multiple Stream consumers | One dispatcher, fan-out to N queues |

### Event List

#### Content Events

Emitted from the Post stream by [`detectContentEvents`](../../packages/ampless/src/events.ts) (pure function, testable without AWS).

| Event | Trigger |
|-------|---------|
| `content.created` | `INSERT` on Post |
| `content.updated` | `MODIFY` on Post (every modification) |
| `content.published` | Post `INSERT` with `status='published'`, or `MODIFY` from draft → published |
| `content.unpublished` | `MODIFY` from published → draft, or `REMOVE` of a published Post |
| `content.deleted` | `REMOVE` on Post |

Several events can be emitted from a single mutation (e.g. an `INSERT` of a published post emits both `content.created` and `content.published`).

#### Media Events

| Event | Trigger |
|-------|---------|
| `media.uploaded` | reserved — defined in the type system, not yet emitted from the stream |
| `media.deleted` | reserved — defined in the type system, not yet emitted from the stream |

#### Site Settings

| Event | Trigger | Payload |
|-------|---------|---------|
| `site.settings.updated` | Any KvStore mutation where `pk='siteconfig'` | empty payload |

Consumed by the built-in trusted processor handler, which rebuilds `public/site-settings.json` so the public site picks up changes within ~60 s (the public site's `revalidate` window).

#### Index-Maintenance Events

| Event | Trigger | Payload |
|-------|---------|---------|
| `post.index.refresh` | Any Post mutation (INSERT / MODIFY / REMOVE) | `{ previous, next }` content-event projections — both populated on MODIFY, `previous` null on INSERT, `next` null on REMOVE |

Consumed by the trusted processor's built-in `rebuildPostTagsForPost` handler ([`packages/backend/src/events/posttag-sync.ts`](../../packages/backend/src/events/posttag-sync.ts)): it computes the (tag × `publishedAt#postId`) diff between the two projections and applies it to the denormalized `PostTag` table via direct DynamoDB Put / Delete. Centralising this in the event pipeline means write paths (admin, MCP, future REST clients) don't need to call a sync helper — every Post write that hits DynamoDB automatically triggers the PostTag refresh. Plugins maintaining their own indexes (search, sitemaps with per-tag pages) can subscribe to the same event.

### Hook Types

| Hook | Execution | Where it runs | Use cases |
|------|-----------|---------------|-----------|
| `before:*` | Reserved (not yet wired) | Would run synchronously inside the writer | Validation, banned word checks, approval workflows |
| `after:*` | Asynchronous via SQS | `processor-trusted` or `processor-untrusted` Lambda, based on plugin `trust_level` | Webhooks, social posts, RSS / sitemap regeneration, cache purge, custom index maintenance |

### event-dispatcher Lambda

Source: [`packages/backend/src/events/dispatcher.ts`](../../packages/backend/src/events/dispatcher.ts). Reads the table name from the stream record's `eventSourceARN`, then:

- **Post stream**: emits one `post.index.refresh` plus zero-to-many `content.*` events per record. Payloads are trimmed projections (no body / format) so SQS messages stay well under 256 KiB even for large posts.
- **KvStore stream**: filters to `pk='siteconfig'` only and emits `site.settings.updated`. Cache rows / plugin state are intentionally ignored.

The dispatcher fans every emitted event out to both `TrustedEventsQueue` and `UntrustedEventsQueue` via `SendMessageBatch`.

### Trust-Level Processors

#### `processor-trusted` ([`processor-trusted.ts`](../../packages/backend/src/events/processor-trusted.ts))

IAM role:

- `dynamodb:Query` / `Scan` on Post + GSI `index/*`
- `dynamodb:Read` on KvStore (for site-settings cache expansion)
- `dynamodb:Write` on PostTag (for tag-index maintenance)
- `s3:PutObject` / `DeleteObject` on `public/plugins/*` and the single key `public/site-settings.json`

Built-in handlers fire **before** trusted plugins on every event:

1. **Site settings cache rebuild** — on `site.settings.updated`, expand the KvStore rows under `siteconfig:*` and write `public/site-settings.json`.
2. **PostTag sync** — on `post.index.refresh`, diff the (tag × `publishedAt#postId`) sets and apply the delta to PostTag.

Trusted plugins receive a `PluginRuntimeContext` with two capabilities: `listPublishedPosts()` (one Query against the `byStatus` GSI) and `writePublicAsset(key, body, contentType)` (S3 PutObject under `public/plugins/{plugin}/{key}`). The key namespacing is enforced in code — a plugin can't write to a sibling's prefix without bypassing the runtime context.

The S3 grant is bucket-wide for `public/plugins/*` rather than per-plugin. Rationale documented inline in `backend.ts`: trusted plugins are first-party-only (so cross-plugin tampering isn't in the threat model), per-plugin enumeration breaks the inline-policy size limit beyond ~50 plugins, and strict per-plugin isolation is planned via plugin-per-Lambda with capability-based dynamic IAM (see [roadmap](./14-roadmap.md)).

#### `processor-untrusted` ([`processor-untrusted.ts`](../../packages/backend/src/events/processor-untrusted.ts))

IAM role: SQS consume only. Zero data permissions.

Untrusted plugins receive a runtime context where `listPublishedPosts` and `writePublicAsset` throw. They get the event payload, can run pure JS, and return — that's it. Outbound HTTP works (webhook plugins live in this tier) but the Lambda's network egress is what bounds it.

### Webhook / Plugin Configuration

Plugins are activated by adding their factory result to `cms.config.plugins`:

```typescript
// cms.config.ts
import { defineConfig } from 'ampless'
import { rssPlugin } from '@ampless/plugin-rss'
import { webhookPlugin } from '@ampless/plugin-webhook'

export default defineConfig({
  plugins: [
    rssPlugin({ /* writes public/plugins/rss/feed.xml on content.published */ }),
    webhookPlugin({
      events: ['content.published', 'content.updated'],
      url: 'https://hooks.zapier.com/...',
    }),
  ],
})
```

The trusted / untrusted Lambdas each filter the plugin list down to their tier and execute matching hooks for each SQS message.

### Future Extensions

The single-fan-out shape is enough for the current scope. Splitting plugins into per-plugin Lambdas with capability-based IAM later grants the option to:

- Eliminate the "trusted plugins share an IAM role" trade-off
- Give privileged plugins arbitrary AWS capabilities without weakening trusted-tier isolation
- Map third-party marketplace plugins onto their own Lambda + IAM role per install

That work is on the [roadmap](./14-roadmap.md); the current topology stays on the dispatcher + 2-queue shape until then.

---
