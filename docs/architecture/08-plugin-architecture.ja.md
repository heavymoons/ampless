> English: [08-plugin-architecture.md](./08-plugin-architecture.md)
> 
## 8. プラグインアーキテクチャ

### 設計方針

ampless のプラグインは、自身の `trust_level` に対応するイベント処理 Lambda の中で動く。サンドボックスは **Lambda の IAM 実行ロール**であり、V8 isolate でも `vm.Script` ラッパーでもない。プロセス内 JS サンドボックスは存在しない。untrusted コードは IAM ロールが空の Lambda で走り、trusted コードは trusted 層に必要な権限だけが付いた Lambda で走る。

V8 isolate サンドボックスのような細粒度 capability を捨てて、AWS ネイティブの分離を取った形。推論しやすく、ネイティブバイナリ依存もなく、`--no-node-snapshot` フラグもコンテナイメージ Lambda も不要。

### プラグイン契約

プラグインは `definePlugin()`（[`packages/ampless/src/plugin.ts`](../../packages/ampless/src/plugin.ts)）の結果を export するだけのプレーンな TS モジュール：

```typescript
export interface AmplessPlugin {
  name: string
  apiVersion: 1
  trust_level: 'untrusted' | 'trusted' | 'privileged'

  // イベントフック — trust_level に対応する Lambda が SQS から受けて実行
  hooks?: { [K in EventType]?: (event, ctx) => Promise<void> }

  // 投稿・サイトレベルのメタデータ — 純関数、リクエスト時に呼ばれる
  metadata?(post: Post, site): PluginMetadata
  siteMetadata?(site): PluginMetadata

  // 動的 OG 画像 — リクエスト時に Next.js ImageResponse でレンダリング
  ogImage?: OgImageConfig
}
```

これらの面を任意に組み合わせる。有効化はプロジェクトの `cms.config.ts` に 1 行：

```typescript
plugins: [
  seoPlugin({ /* ... */ }),
  rssPlugin({ /* ... */ }),
]
```

### trust_level

#### `untrusted`

- **IAM**：SQS 受信のみ。データ系の AWS 権限はゼロ。
- **ランタイムコンテキスト**：`listPublishedPosts()` と `writePublicAsset()` はいずれも throw する。
- **できること**：純 JS と外向き HTTP（Lambda の egress は通る）。
- **用途**：Webhook 配送、in-process のコンテンツ変換、OG 画像テンプレ描画（実際の描画は untrusted Lambda ではなく公開 Next.js プロセス内で行う）。
- **ファーストパーティ例**：`@ampless/plugin-og-image`、`@ampless/plugin-webhook`。

#### `trusted`

- **IAM**：Post と GSI に対する `dynamodb:Query` / `Scan`、KvStore に対する `dynamodb:Read`、PostTag に対する `dynamodb:Write`、`public/plugins/*` に対する `s3:PutObject` / `DeleteObject`、加えて組み込みハンドラ用に `public/site-settings.json` への正確一致 grant。
- **ランタイムコンテキスト**：`listPublishedPosts()` は `byStatus` GSI に Query 1 発。`writePublicAsset(key, body, contentType)` は `public/plugins/{plugin}/{key}` への書き込み。
- **用途**：SEO メタデータ、RSS フィード生成、sitemap 再構築、独自インデックス維持。
- **ファーストパーティ例**：`@ampless/plugin-seo`、`@ampless/plugin-rss`。

trusted Lambda の S3 grant がプラグイン単位ではなく `public/plugins/*` でバケットワイルドカードなのは意図的：trusted プラグインはファーストパーティ限定なので互いの干渉は脅威モデル外、プラグインごとの enumeration は IAM インラインポリシーの 10 KiB 上限を約 50 プラグインで超える、そしてランタイムコンテキストがキーをプラグイン名でネームスペース化しているため、コンテキストを介さない限り隣のプレフィックスには書けない。厳密な per-plugin 分離は[ロードマップ](./14-roadmap.md)の「プラグイン 1 つ = Lambda 1 つ + capability ベース IAM」案件。

#### `privileged`

予約。契約上 `trust_level: 'privileged'` は受け取れるが、現状 privileged 用の Lambda は用意されていない。想定される将来形：

- privileged プラグイン 1 つにつき 1 Lambda。
- プラグインが capability リストを宣言し、CDK がそれを IAM ポリシーに展開する。
- 用途：メール送信（SES）、独自テーブルへのフォーム投稿保存、外部の有料 API 呼び出し、private S3 プレフィックスへのアクセス。

trusted / untrusted の運用が固まり、実需が出た時点で着手する。

### プラグインがどこで動くか

| 面 | 実行場所 | 発火タイミング |
|---|---|---|
| `hooks` | `processor-trusted` / `processor-untrusted` Lambda（`trust_level` 別） | SQS メッセージ到着時 — つまり元の DynamoDB 書き込みの後 |
| `metadata` / `siteMetadata` | 公開 Next.js プロセス（リクエストスレッド） | テーマコンポーネント / `generateMetadata()` 内 |
| `ogImage` | 公開 Next.js プロセス — `app/og/[slug]/route.ts` 等 | OG 画像 URL がリクエストされたとき |

`hooks` がプラグインの非同期面、`metadata` / `siteMetadata` / `ogImage` が同期面で、後者は公開サイト内で動き、AWS データ権限を持たない（純関数か、渡された値だけを読む）。

### プラグインの状態保存

プラグインは 3 つの仕組みで状態を保持する。どれも「プラグイン 1 つに DynamoDB テーブル 1 つ」ではない：

| 仕組み | 場所 / 形 | 用途 |
|---|---|---|
| `writePublicAsset(key, body, contentType)` | S3 `public/plugins/{plugin}/{key}` | 公開サイトがフェッチする生成物：RSS、sitemap XML、JSON インデックス |
| `KvStore`（AppSync 経由で admin/editor が書く） | DynamoDB 行 `pk='pluginstate:{plugin}:...'`、TTL 任意 | プラグインがあとで読み直したい小さな状態（カウンタ、最終実行時刻） |
| `cms.config.ts` のコンストラクタ引数 | プラグイン factory の引数 | デプロイに焼き込む静的設定 |

`private/plugins/` という S3 プレフィックスも `ampless-plugin-data` テーブルも存在しない。プラグインが private 領域を必要とするケースは、将来 privileged 層が解決する。

### S3 レイアウト

```
s3://<bucket>/
  public/
    media/YYYY/MM/<epoch>-<name>          ← アップロードされたメディア
    plugins/{plugin}/{key}                ← trusted プラグインの成果物（writePublicAsset）
    static/{slug}/<file>                  ← format: 'static' 投稿のバンドル
    site-settings.json                    ← サイト設定キャッシュ
```

`public/` 以下はバケットポリシー（あるいはメディアの場合は `/api/media/...` プロキシ）から読める。プラグインの書き込みは trusted ランタイムコンテキストにより `public/plugins/{plugin}/{key}` に限定される。

### API バージョニング

プラグインは `apiVersion: 1` を宣言する。ampless は理解できないバージョンを拒否する。現状は 1 のみがサポートされており、このフィールドは将来の forward-compat 用フックであって、現時点で分岐に使われてはいない。

```typescript
export default seoPlugin({/* config */}) // → { apiVersion: 1, name: 'seo', ... }
```

### プラグインマニフェスト（npm 公開プラグイン）

サードパーティプラグインは通常の npm tarball として公開し、factory を default export する。「マニフェスト」は factory が返すランタイムオブジェクトそのもので、別に JSON マニフェストファイルは置かない。

### Lambda メモリ設定

| Lambda | メモリ | 備考 |
|---|---|---|
| `processor-untrusted` | 256 MB | 純 JS + 外向き HTTP には十分。 |
| `processor-trusted` | 512 MB | 組み込みハンドラ + trusted 層プラグインを SQS バッチ内で直列実行するため余裕を持たせる。 |
| `mcp-handler` | 512 MB | Lambda Function URL + AppSync SigV4 + S3 PutObject。 |

Node.js 22 の cold start は 200〜400 ms 程度で、CMS ワークロードでは無視できる。

### 外向きネットワーク

untrusted / trusted の両 Lambda ともデフォルトでインターネット egress を持つ。webhook プラグイン（untrusted）はこれに依存する。VPC private subnet に置いて egress を切る選択肢はあるが、デフォルトではしない — プラグインから到達できるリーク面はそもそも公開済みコンテンツに限られており、健全な運用者を想定すれば egress は意味のある exfil 経路にならない。

### 採用しなかった案

- **`isolated-vm` / V8 isolate サンドボックス。** Node ≥ 20 で `--no-node-snapshot` が必要 → コンテナイメージ Lambda が必要 → cold start 劣化、メンテ負荷、ネイティブバイナリビルドが付いてくる。IAM ベース分離を代替として選んだ。
- **`quickjs-emscripten` 等のプロセス内サンドボックス。** 将来のマーケットプレイス層で検討する案件で、今は使わない。
- **プラグイン専用 DynamoDB テーブル。** アカウントあたり 2,500 テーブルというソフトリミット、インストールごとに CDK デプロイが要る、削除時のクリーンアップが複雑、といった問題がある。現行プラグインの要件は KvStore + S3 で足りている。

---
