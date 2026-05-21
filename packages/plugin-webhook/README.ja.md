> English: [README.md](./README.md)
> 

# @ampless/plugin-webhook

ampless イベントを 1 つ以上の外部 URL に POST で通知します。

> **プレリリース / アルファ版。** v1.0 まではマイナーバージョンでも破壊的変更が入る可能性があります。

**untrusted** Lambda で実行されます — アウトバウンド HTTPS 呼び出しのみ行い、AWS データには一切触れないため、Webhook 受信先が侵害されても CMS への侵入口にはなりません。

## インストール

```bash
npm install @ampless/plugin-webhook@alpha
```

## 設定

`cms.config.ts` に記述します：

```ts
import webhookPlugin from '@ampless/plugin-webhook'

export default defineConfig({
  // ...
  plugins: [
    webhookPlugin({
      endpoints: [
        {
          url: 'https://example.com/hooks/ampless',
          secret: process.env.WEBHOOK_SECRET,
          events: ['content.published', 'content.unpublished', 'content.deleted'],
        },
        {
          url: 'https://discord.com/api/webhooks/.../...',
          // secret なし — Discord は署名を検証しない
          events: ['content.published'],
        },
      ],
    }),
  ],
})
```

| オプション | デフォルト | 備考 |
|---|---|---|
| `endpoints[].url` | 必須 | POST 先の HTTPS エンドポイント |
| `endpoints[].secret` | なし | 設定時、本文を HMAC-SHA-256 で署名して `X-Ampless-Signature` ヘッダーで送信 |
| `endpoints[].events` | すべての `content.*` | このエンドポイントを発火するイベント種別を絞り込む |
| `endpoints[].headers` | `{}` | 全リクエストにマージされる追加ヘッダー |
| `endpoints[].timeoutMs` | `5000` | リクエストごとのタイムアウト |
| `url`（トップレベル） | なし | 単一エンドポイントのショートカット。`endpoints: [{ url, secret }]` と同等 |
| `secret`（トップレベル） | なし | トップレベルの `url` と対で使用 |

## リクエスト形式

```http
POST /hooks/ampless HTTP/1.1
Host: example.com
Content-Type: application/json
X-Ampless-Event: content.published
X-Ampless-Signature: sha256=<hex>

{
  "type": "content.published",
  "payload": {
    "siteId": "default",
    "postId": "post-001",
    "slug": "hello",
    "title": "Hello",
    "status": "published",
    "publishedAt": "2026-04-30T00:00:00.000Z",
    "tags": ["intro"]
  },
  "timestamp": "2026-04-30T00:00:01.000Z"
}
```

## 署名の検証（Node.js）

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

function verify(rawBody: string, signatureHeader: string, secret: string): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signatureHeader)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
```

HMAC は必ず JSON パース前の**生のリクエストボディ**に対して計算し、定数時間比較を使用してください。

## リトライ動作

いずれかのエンドポイントが 2xx 以外のレスポンスを返した場合（またはタイムアウトした場合）、プラグインは例外を投げます。トラストレベルプロセッサーの Lambda が SQS に再スローし、デッドレターキューに移動するまで最大 3 回リトライされます。同じイベントが複数回配信される可能性があるため、冪等な受信側を推奨します。

## 発火するイベント

- `content.created` — 新規投稿（任意のステータス）
- `content.published` — ステータスが `draft` → `published` に変化、または公開済み投稿が挿入された
- `content.unpublished` — ステータスが `published` → `draft` に変化、または公開済み投稿が削除された
- `content.updated` — 任意の MODIFY（公開 / 非公開への遷移時にも `published` / `unpublished` と同時に発火）
- `content.deleted` — 投稿が削除された
