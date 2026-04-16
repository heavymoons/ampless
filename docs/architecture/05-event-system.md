## 5. イベントシステム

### 設計思想

CMS のライフサイクルイベントにフックを提供し、プラグインや外部サービスとの連携口とする。
SNS 連携等の具体的な機能はコアに持たず、フック + Webhook で外部に委譲する。

after フックは DynamoDB Streams + SQS を使い、
どの経路（管理画面 / MCP / REST API）からの変更でも確実にイベントを捕捉する。

### アーキテクチャ

```
[同期: before フック]
  Core ライブラリ内で実行。処理をブロック可能。

  API Route / MCP / REST API
    → Core: before フック実行（バリデーション等）
    → Core: DynamoDB 書き込み

[非同期: after フック]
  DynamoDB Streams → SQS 経由で非同期実行。

  DynamoDB Stream
    → event-dispatcher Lambda（イベント判定、SQS に投入）
      → SQS: ampless-events
        → event-processor Lambda
            ├── after フック実行
            ├── Webhook 送信
            ├── S3 キャッシュ再生成 / RSS 再生成
            └── 失敗 → DLQ (ampless-events-dlq)
```

### SQS を挟む理由

| 観点 | Stream → 直接実行 | Stream → SQS → 実行 |
|------|------------------|---------------------|
| リトライ制御 | 全レコード再処理 | メッセージ単位でリトライ |
| 失敗処理 | Stream DLQ は制限あり | SQS DLQ で簡単に失敗メッセージを退避 |
| 流量制御 | バッチサイズだけ | 並行数・visibility timeout で細かく制御 |
| 処理の独立性 | 1件の失敗でバッチ全体がリトライ | 失敗したメッセージだけリトライ |

### イベント一覧

#### コンテンツ系

| イベント | タイミング |
|---------|-----------|
| `content.created` | 記事作成時 |
| `content.updated` | 記事更新時 |
| `content.published` | 下書き → 公開時 |
| `content.unpublished` | 公開 → 非公開時 |
| `content.deleted` | 記事削除時 |
| `content.scheduled` | 予約公開セット時 |

#### メディア系

| イベント | タイミング |
|---------|-----------|
| `media.uploaded` | メディアアップロード時 |
| `media.deleted` | メディア削除時 |

#### サイト / ユーザー系

| イベント | タイミング |
|---------|-----------|
| `site.deployed` | デプロイ完了時 |
| `site.settings.updated` | サイト設定変更時 |
| `user.login` | ログイン時 |
| `user.created` | ユーザー作成時 |

### フックの種類

| フック | 実行方式 | 実行場所 | 用途 |
|--------|---------|---------|------|
| `before:*` | 同期。false を返すと処理をブロック | Core ライブラリ内 | バリデーション、承認フロー、禁止語チェック |
| `after:*` | 非同期。失敗しても元の処理は取り消さない | event-processor Lambda (SQS 経由) | Webhook、SNS 投稿、RSS 再生成、キャッシュパージ |

### event-dispatcher Lambda

DynamoDB Stream から呼ばれ、イベントを判定して SQS に投入する。軽量に保つ。

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

### Core ライブラリでの before フック

```typescript
// packages/ampless/src/core.ts
async function publishPost(auth: AuthContext, siteId: string, postId: string) {
  // 1. before フック（同期、ブロック可能）
  const result = await runBeforeHooks('content.published', post)
  if (!result.ok) throw new Error(result.reason)

  // 2. DynamoDB 書き込み
  await dynamodb.update({ status: 'published', ... })

  // 3. after フックは書かない — DynamoDB Streams → SQS が拾う
}
```

### Webhook 設定

```typescript
// cms.config.ts
export default defineConfig({
  hooks: {
    'before:content.published': async (event) => {
      if (event.content.title.includes('禁止語')) {
        return { ok: false, reason: 'タイトルに禁止語が含まれています' }
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

Webhook は event-processor Lambda が SQS メッセージを受け取った際に送信する。

```
記事公開 → DynamoDB Stream → SQS → event-processor
  → Webhook POST → Zapier → X に投稿
                  → n8n → Bluesky に投稿
                  → Lambda → LINE 通知
```

### 将来拡張

SNS トピックを event-dispatcher と SQS の間に挟めば、複数キューへの配信が可能:

```
event-dispatcher → SNS (ampless-events topic)
  ├── SQS: hooks-queue     → フック/Webhook 処理
  ├── SQS: cache-queue     → S3 キャッシュ再生成
  └── SQS: analytics-queue → 分析用（プラグイン）
```

v0.1 では SQS 1 本で十分。SNS は必要になってから追加する。

### v1 方針
- v0.1: DynamoDB Streams + SQS + `content.published` の after フック + Webhook
- v0.2: before フック、メディア系イベント
- v1.0: 全イベント対応、SNS によるキュー分岐

---
