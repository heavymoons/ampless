> English: [05-event-system.md](./05-event-system.md)
> 
## 5. イベントシステム

### 設計方針

CMS のライフサイクルイベントを、プラグインや外部サービス連携のための統合ポイントとして発行する。SNS / RSS / アナリティクス等の具体機能はコアに組み込まず、プラグイン + Webhook が外部に委譲する。

`after` イベントは **DynamoDB Streams → SQS → プロセッサ Lambda** を流れる。テーブルに書き込みが届きさえすれば、どの経路（管理 UI / MCP / 将来の REST）から書かれたものであってもイベント発火が保証される。このパイプラインに EventBridge は介在せず、dispatcher Lambda が Stream に直接ぶら下がる。

### アーキテクチャ

```
DynamoDB Stream (Post)         →┐
DynamoDB Stream (KvStore)      →┤
                                ├→ event-dispatcher Lambda
                                │     │
                                │     ├→ SQS: TrustedEventsQueue   → processor-trusted   Lambda
                                │     └→ SQS: UntrustedEventsQueue → processor-untrusted Lambda
                                │              │                            │
                                │              └→ 共有 EventsDlq (DLQ)      ←┘
                                │   (maxReceiveCount: 3, retention: 14日)
```

配線は [`packages/backend/src/backend.ts`](../../packages/backend/src/backend.ts#L177)。

要点：

- **「ルーティング」ではなく「fan-out」。** 全イベントが**両方の**キューに送られる。trust_level の分離は、どのキューに乗せるかではなく、各プロセッサ Lambda の **IAM 実行ロール**で実現する。trusted プラグインが Post を読めるのは、その Lambda に `dynamodb:Query` 権限があるから。untrusted プラグインが読めないのは、その Lambda がデータ系の AWS 権限を一切持たないから。
- **DLQ は 1 つだけ共有。** リトライ 3 回でダメなら `EventsDlq` に落ちる（14日間保持）。メインキューは visibility timeout だけ違う（trusted 120s、untrusted 60s）— それぞれの想定処理時間に合わせている。
- **入力ソースは 2 つ。** dispatcher は Post と KvStore の両 Stream を購読する。ただし KvStore は `pk='siteconfig'` のみフィルタし、それ以外の cache 行・プラグイン state は無視する。

`before` フックは型では予約されているが、**プラグインへの配線は未実装**。`definePlugin` は受け取れるが、書き込みの前に実際に何かが発火する経路は現状ない。

### なぜ Stream とプロセッサの間に SQS を挟むのか

| 観点 | Stream → 直接実行 | Stream → SQS → 実行 |
|------|------------------|---------------------|
| リトライ制御 | バッチ全レコードをやり直し | メッセージ単位 |
| 失敗の隔離 | 1 件失敗でバッチ全体を再処理 | 失敗メッセージだけ再処理 |
| 失敗の隔離先 | Stream DLQ は制約が多い | SQS DLQ がファーストクラス |
| 並列度制御 | バッチサイズのみ | SQS の concurrency + visibility timeout |
| trust_level 分離 | 複数の Stream consumer が要る | dispatcher 1 つで N キューに fan-out できる |

### イベント一覧

#### コンテンツ系

Post Stream から [`detectContentEvents`](../../packages/ampless/src/events.ts)（純関数、AWS 非依存でテスト可能）で生成。

| イベント | 発火条件 |
|---------|----------|
| `content.created` | Post の `INSERT` |
| `content.updated` | Post の `MODIFY`（あらゆる変更） |
| `content.published` | `INSERT` で `status='published'`、または `MODIFY` で draft → published |
| `content.unpublished` | `MODIFY` で published → draft、または published 状態での `REMOVE` |
| `content.deleted` | Post の `REMOVE` |

1 回のミューテーションから複数のイベントが発火することがある（例：公開状態での `INSERT` は `content.created` + `content.published` を両方発火）。

#### メディア系

| イベント | 発火条件 |
|---------|----------|
| `media.uploaded` | 予約（型は定義済みだが Stream からの発行は未実装） |
| `media.deleted` | 予約（型は定義済みだが Stream からの発行は未実装） |

#### サイト設定

| イベント | 発火条件 | ペイロード |
|---------|----------|-----------|
| `site.settings.updated` | `pk='siteconfig'` の KvStore ミューテーション全般 | 空 |

trusted プロセッサの組み込みハンドラが受け、`public/site-settings.json` を再生成する。公開サイトは `revalidate: 60` で読みに行くので、変更は約 60 秒で反映される。

#### インデックス維持系

| イベント | 発火条件 | ペイロード |
|---------|----------|-----------|
| `post.index.refresh` | Post の任意のミューテーション（INSERT / MODIFY / REMOVE） | `{ previous, next }` の content-event 投影。MODIFY は両方、INSERT は `previous=null`、REMOVE は `next=null` |

trusted プロセッサの組み込み `rebuildPostTagsForPost` ハンドラ ([`packages/backend/src/events/posttag-sync.ts`](../../packages/backend/src/events/posttag-sync.ts)) が受け、2 つの投影から (tag × `publishedAt#postId`) の差分を計算して、非正規化 `PostTag` テーブルに Put / Delete で適用する。これをイベントパイプラインに集約しているおかげで、書き込み側（管理画面・MCP・将来の REST）は同期ヘルパーを呼ばなくてよくなる。DynamoDB に書き込まれた瞬間に自動で PostTag が更新される。検索や per-tag ページの sitemap など、独自インデックスを持つプラグインも同じイベントを購読すれば良い。

### フックの種類

| フック | 実行 | 実行場所 | 用途 |
|--------|------|----------|------|
| `before:*` | 予約（未配線） | 書き込み側で同期実行する想定 | バリデーション、禁止語チェック、承認ワークフロー |
| `after:*` | SQS 経由で非同期 | プラグインの `trust_level` に応じて `processor-trusted` か `processor-untrusted` | Webhook、SNS 投稿、RSS / sitemap 再生成、キャッシュパージ、独自インデックス維持 |

### event-dispatcher Lambda

ソース：[`packages/backend/src/events/dispatcher.ts`](../../packages/backend/src/events/dispatcher.ts)。Stream レコードの `eventSourceARN` からテーブル名を取り出し、

- **Post Stream**：レコードごとに `post.index.refresh` を 1 つと、`content.*` を 0 〜複数発行。ペイロードは body / format を落とした投影のみ — 巨大投稿でも SQS の 256 KiB 制限に余裕で収まる。
- **KvStore Stream**：`pk='siteconfig'` のみフィルタして `site.settings.updated` を発行。cache 行やプラグイン state は意図的に無視。

dispatcher は発行したイベントを `SendMessageBatch` で `TrustedEventsQueue` と `UntrustedEventsQueue` の**両方**に投げる。

### trust_level 別プロセッサ

#### `processor-trusted` ([`processor-trusted.ts`](../../packages/backend/src/events/processor-trusted.ts))

IAM ロール：

- Post と GSI `index/*` に対する `dynamodb:Query` / `Scan`
- KvStore に対する `dynamodb:Read`（site-settings のキャッシュ展開用）
- PostTag に対する `dynamodb:Write`（タグインデックス維持用）
- `public/plugins/*` と、固定キー `public/site-settings.json` に対する `s3:PutObject` / `DeleteObject`

各イベント受信時、trusted プラグインより**先に**組み込みハンドラが走る：

1. **サイト設定キャッシュ再構築** — `site.settings.updated` を受けて、KvStore の `siteconfig:*` を展開し `public/site-settings.json` を書き出す。
2. **PostTag 同期** — `post.index.refresh` を受けて、(tag × `publishedAt#postId`) 集合の差分を計算し PostTag に適用。

trusted プラグインに渡される `PluginRuntimeContext` は 2 つの capability を持つ：`listPublishedPosts()`（`byStatus` GSI に対する Query 1 回）と `writePublicAsset(key, body, contentType)`（`public/plugins/{plugin}/{key}` への S3 PutObject）。キーの namespace 分離はコードで強制されており、ランタイムコンテキストを介さない限り隣のプラグインのプレフィックスには書けない。

S3 grant をプラグイン単位ではなく `public/plugins/*` でバケットワイルドカードにしているのは意図的：(1) trusted プラグインはファーストパーティ限定なので互いの干渉は脅威モデル外、(2) プラグインごとの enumeration は IAM インラインポリシーの 10 KiB 上限を約 50 プラグインで超える、(3) 厳密な per-plugin 分離は v2.0 系で「プラグイン 1 つ = Lambda 1 つ + capability ベースの動的 IAM」として再設計する予定（[ロードマップ](./14-roadmap.md)参照）。

#### `processor-untrusted` ([`processor-untrusted.ts`](../../packages/backend/src/events/processor-untrusted.ts))

IAM ロール：SQS 受信のみ。データ系の権限はゼロ。

untrusted プラグインに渡されるランタイムコンテキストでは `listPublishedPosts` と `writePublicAsset` がいずれも throw する。受け取れるのはイベントペイロードのみ、純 JS を実行して return するだけ。外向き HTTP は通る（webhook プラグインはこの層に住む）が、それは Lambda の network egress の話。

### Webhook / プラグインの設定

プラグインは factory 呼び出し結果を `cms.config.plugins` に追加して有効化する：

```typescript
// cms.config.ts
import { defineConfig } from 'ampless'
import { rssPlugin } from '@ampless/plugin-rss'
import { webhookPlugin } from '@ampless/plugin-webhook'

export default defineConfig({
  plugins: [
    rssPlugin({ /* content.published で public/plugins/rss/feed.xml を書き出す */ }),
    webhookPlugin({
      events: ['content.published', 'content.updated'],
      url: 'https://hooks.zapier.com/...',
    }),
  ],
})
```

trusted / untrusted の各 Lambda はそれぞれ自分の層に合うプラグインだけにフィルタし、SQS メッセージごとに該当フックを実行する。

### 将来の拡張

現在の単一 fan-out 構成は当面のスコープには十分。将来「プラグイン 1 つ = Lambda 1 つ + capability ベースの IAM」へ分割すると、以下が可能になる：

- 「trusted プラグインが IAM ロールを共有する」というトレードオフを解消
- privileged プラグインに自由な AWS capability を渡しても trusted 層の隔離を弱めない
- サードパーティマーケットプレイス上のプラグインを「インストールごとに Lambda + IAM ロール」へ写像する

これは[ロードマップ](./14-roadmap.md)項目。それまでは dispatcher + 2 キュー構成のまま走る。

---
