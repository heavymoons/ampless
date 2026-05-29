> English: [08-plugin-architecture.md](./08-plugin-architecture.md)
> 
## 8. プラグインアーキテクチャ

> **プラグインを書く人向け**: 本ページは設計仕様。実装手順は別ドキュメント [`packages/ampless/docs/plugin-author-guide.ja.md`](../../packages/ampless/docs/plugin-author-guide.ja.md) に集約しています(`ampless` の npm tarball にも同梱されるほか、scaffold したサイトリポジトリの `docs/plugin-author-guide.ja.md` にもコピーされます)。

### 設計方針

ampless のプラグインは、自身の `trust_level` に対応するイベント処理 Lambda の中で動く。サンドボックスは **Lambda の IAM 実行ロール**であり、V8 isolate でも `vm.Script` ラッパーでもない。プロセス内 JS サンドボックスは存在しない。untrusted コードは IAM ロールが空の Lambda で走り、trusted コードは trusted 層に必要な権限だけが付いた Lambda で走る。

V8 isolate サンドボックスのような細粒度 capability を捨てて、AWS ネイティブの分離を取った形。推論しやすく、ネイティブバイナリ依存もなく、`--no-node-snapshot` フラグもコンテナイメージ Lambda も不要。

### プラグイン契約

プラグインは `definePlugin()`（[`packages/ampless/src/plugin.ts`](../../packages/ampless/src/plugin.ts)）の結果を export するだけのプレーンな TS モジュール。目標形：

```typescript
export interface AmplessPlugin {
  name: string
  apiVersion: 1
  trust_level: 'untrusted' | 'trusted' | 'privileged'

  // インストール単位の namespace。デフォルトは `name`。
  // 同じプラグインを複数 instance（例: GTM 2 container）登録するときに分ける。
  instanceId?: string

  // admin UI 用の表示名。
  displayName?: LocalizedString

  // 宣言された capability リスト。runtime は宣言と実装の不一致で warning を出し、
  // `cms.config.ts` の `allowCapabilities` が危険 capability
  // (admin page / server route / secrets 等) のゲートになる。
  capabilities?: readonly PluginCapability[]

  // イベントフック — trust_level に対応する Lambda が SQS から受けて実行
  hooks?: { [K in EventType]?: (event, ctx) => Promise<void> }

  // 投稿・サイトレベルのメタデータ — 純関数、リクエスト時に呼ばれる
  metadata?(post: Post, site): PluginMetadata
  siteMetadata?(site): PluginMetadata

  // 宣言的な head/body 注入。ReactNode ではなく descriptor 配列を返す。
  // 公開 Next.js プロセスが request 時に validation + render する。
  // Phase 1 (実装済み — docs/tmp/plugin-extension-spec.md 参照)。
  publicHead?(ctx): readonly PublicHeadDescriptor[]
  publicBodyEnd?(ctx): readonly PublicBodyDescriptor[]

  // 投稿単位の body 注入。テーマの post ページテンプレートが render する。
  // `inlineScript` + `scriptType: 'application/ld+json'` のみ受け付ける。
  // 他の scriptType は drop + warn される。
  // Phase 4 (実装済み)。capability: `schema`。
  publicBodyForPost?(post: Post, ctx): readonly PublicPostBodyDescriptor[]

  // 動的 OG 画像 — リクエスト時に Next.js ImageResponse でレンダリング
  ogImage?: OgImageConfig
}
```

`capabilities` / `instanceId` / `displayName` / `publicHead` / `publicBodyEnd` は **Phase 1 拡張**にあたるフィールドで、型追加は Phase 1 spec ([docs/tmp/plugin-extension-spec.md](../tmp/plugin-extension-spec.md)) の範囲。`publicBodyForPost` は **Phase 4 拡張** — 投稿単位の body 注入、主に JSON-LD 構造化データ向け。既存ファーストパーティプラグイン (`seo` / `rss` / `og-image` / `webhook`) はこれらを宣言しなくても動作し続ける。

これらの面を任意に組み合わせる。有効化はプロジェクトの `cms.config.ts` に 1 行：

```typescript
plugins: [
  seoPlugin({ /* ... */ }),
  rssPlugin({ /* ... */ }),
]
```

### Capability モデル

`capabilities` はプラグインが何をしたいかの宣言。runtime / admin がバリデーション、UI ラベル、危険機能のゲートに使う。

実装済み capability:

| capability | 意味 | 既定許可 trust_level |
|---|---|---|
| `publicHead` | `<head>` への descriptor 注入 (Phase 1、実装済み) | `untrusted` 以上 |
| `publicBody` | `<body>` 末尾への descriptor 注入 (Phase 1、実装済み) | `untrusted` 以上 |
| `metadata` | 既存の `metadata()` / `siteMetadata()` 経路 | `untrusted` 以上 |
| `eventHooks` | 既存の async event hooks (`hooks`) | `untrusted` 以上（既存 `@ampless/plugin-webhook` が untrusted で hooks を使う実装と整合） |
| `writePublicAsset` | trusted hook context から、検証済み・namespace 付きの public asset を書く (Phase 3、実装済み) | `trusted` 以上 |

Phase 2 で追加:

| capability | 意味 | 既定許可 trust_level |
|---|---|---|
| `adminSettings` | `/admin/plugins` から編集可能な `settings.public` フィールドを 1 つ以上宣言 (Phase 2、実装済み) | `untrusted` 以上 |

Phase 4 で追加:

| capability | 意味 | 既定許可 trust_level |
|---|---|---|
| `schema` | `publicBodyForPost()` — 投稿単位の body 注入、主に JSON-LD 構造化データ向け。テーマの post ページテンプレートが render する (Phase 4、実装済み) | `untrusted` 以上 |

予約済み capability（名前のみ、実装は後続フェーズ — [docs/tmp/plugin-extension-roadmap.md](../tmp/plugin-extension-roadmap.md) 参照）:

`contentFields` · `adminPage` · `serverRoute` · `secretSettings` (Phase 6a) · `network` · `scheduler` · `storageWrite` · `privilegedSystem`。

「危険」カテゴリ (`adminPage` / `serverRoute` / `secretSettings` / `network` / `scheduler` / `storageWrite` / `privilegedSystem`) は、プラグインパッケージ側で宣言されていても `cms.config.ts` 側で明示許可しないと有効化されない:

```typescript
plugins: [
  somePrivilegedPlugin({ ... }, { allowCapabilities: ['serverRoute', 'secretSettings'] }),
]
```

これで「うっかり入れた npm パッケージが admin ルートを増やす」「secret を読む」を防ぐ。

### trust_level

#### `untrusted`

- **IAM**：SQS 受信のみ。データ系の AWS 権限はゼロ。
- **ランタイムコンテキスト**：`listPublishedPosts()` と `writePublicAsset()` はいずれも throw する。
- **できること**：純 JS と外向き HTTP（Lambda の egress は通る）。
- **用途**：Webhook 配送、in-process のコンテンツ変換、OG 画像テンプレ描画（実際の描画は untrusted Lambda ではなく公開 Next.js プロセス内で行う）。
- **ファーストパーティ例**：`@ampless/plugin-og-image`、`@ampless/plugin-webhook`。

#### `trusted`

- **IAM**：Post と GSI に対する `dynamodb:Query` / `Scan`、KvStore に対する `dynamodb:Read`、PostTag に対する `dynamodb:Write`、`public/plugins/*` に対する `s3:PutObject` / `DeleteObject`、加えて組み込みハンドラ用に `public/site-settings.json` への正確一致 grant。
- **ランタイムコンテキスト**：`listPublishedPosts()` は `byStatus` GSI に Query 1 発。`writePublicAsset(key, body, contentType)` は `public/plugins/{instanceId ?? name}/{key}` への書き込み。
- **用途**：SEO メタデータ、RSS フィード生成、sitemap 再構築、独自インデックス維持。
- **ファーストパーティ例**：`@ampless/plugin-seo`、`@ampless/plugin-rss`。

trusted Lambda の S3 grant がプラグイン単位ではなく `public/plugins/*` でバケットワイルドカードなのは意図的：trusted プラグインはファーストパーティ限定なので互いの干渉は脅威モデル外、プラグインごとの enumeration は IAM インラインポリシーの 10 KiB 上限を約 50 プラグインで超える、そしてランタイムコンテキストがキーを plugin instance でネームスペース化しているため、コンテキストを介さない限り隣のプレフィックスには書けない。Phase 3 で `writePublicAsset` を正式化するときもこの分離方針を維持する: **IAM は processor 全体の prefix のみ強制、plugin instance 単位の prefix は runtime context 層で強制**。trusted processor は各 plugin に `instanceId ?? name` に bound された storage handle を渡し、書き込み前に key を検証する（絶対パス、`.` / `..` segment、backslash、制御文字、256 文字超を禁止）。また、`capabilities` を宣言している plugin が `writePublicAsset` を含めずに実際に `ctx.writePublicAsset()` を呼んだ場合は 1 回だけ warn する。`capabilities` 未宣言の旧 plugin は warn なしで動き続ける。プラグインごとに Lambda を分離して capability ベース IAM を発行する大規模再設計は[ロードマップ](./14-roadmap.md)に残るが、Phase 3 のドッグフードで runtime 層の強制が不十分と判明した場合のみ着手する。

#### `privileged`

予約。契約上 `trust_level: 'privileged'` は受け取れるが、現状 privileged 用の Lambda は用意されていない。想定される将来形：

- privileged プラグイン 1 つにつき 1 Lambda。
- プラグインが capability リストを宣言し、CDK がそれを IAM ポリシーに展開する。
- 用途：メール送信（SES）、独自テーブルへのフォーム投稿保存、外部の有料 API 呼び出し、private S3 プレフィックスへのアクセス。

trusted / untrusted の運用が固まり、実需が出た時点で着手する。

### プラグインがどこで動くか

| 面 | 実行場所 | 発火タイミング |
|---|---|---|
| `hooks` | `processor-trusted` / `processor-untrusted` Lambda（`trust_level` 別） | SQS メッセージ到着時 — つまり元の DynamoDB 書き込みの後。trusted hooks では `ctx.writePublicAsset` は plugin namespace 内だけに書ける |
| `metadata` / `siteMetadata` | 公開 Next.js プロセス（リクエストスレッド） | テーマコンポーネント / `generateMetadata()` 内 |
| `publicHead` / `publicBodyEnd` | 公開 Next.js プロセス — root layout | サイト全体描画時 |
| `publicBodyForPost` | 公開 Next.js プロセス — テーマの post ページテンプレート | 投稿単位の描画時。`pages/post.tsx`（相当ファイル）から呼ばれる。`scriptType: 'application/ld+json'` 必須 |
| `ogImage` | 公開 Next.js プロセス — `app/og/[slug]/route.ts` 等 | OG 画像 URL がリクエストされたとき |

`hooks` がプラグインの非同期面、`metadata` / `siteMetadata` / `publicHead` / `publicBodyEnd` / `ogImage` が同期面で、後者は公開サイト内で動き、AWS データ権限を持たない（純関数か、渡された値だけを読む）。同期面はプラグインの `trust_level` IAM ロールの影響を受けない。IAM ロールが効くのは `hooks` だけ。

### Descriptor ベースの head/body 注入

`publicHead` / `publicBodyEnd` は **descriptor 配列** を返す。`ReactNode` は返さない。descriptor のホワイトリスト:

- `script`（外部 `src`、`strategy` は `afterInteractive` / `lazyOnload` のみ許可）
- `inlineScript`（id 必須、body 文字列。CSP nonce 連携は別 RFP で）
- `meta`、`link`、`noscript`
- `iframe`（body 側のみ）

URL スキーム denylist、`attrs` allowlist、`id` 重複の扱いは runtime 層の validation 時に強制する。任意 `ReactNode` を安全 API では提供しない — それを許すと SSR 時の任意コード実行が暗黙の安全境界になり、untrusted の前提が崩れる。プロジェクトローカルなプラグインでどうしても必要なケースは、将来 Phase 6b で `developer.headElements`（opt-in capability）として別経路で提供する。

descriptor の完全な型定義と validation contract は [docs/tmp/plugin-extension-spec.md](../tmp/plugin-extension-spec.md) に集約。

### JSON-LD 自動 escape

`inlineScript` descriptor が `scriptType: 'application/ld+json'` を持つとき、runtime は **`body` 文字列を自動 escape** してから描画する — `<` → `<`、`>` → `>`、`&` → `&`、U+2028 → ` `、U+2029 → ` `（`escapeJsonLdInlineBody` 経由）。この処理は `inlineScript` を受け付ける 3 つのサーフェス (`publicHead` / `publicBodyEnd` / `publicBodyForPost`) すべてで行われる。plugin 作者は生の JSON 文字列をそのまま返せばよく、自前で escape しなくてよい。

### サーフェス別 scriptType 厳格度

| サーフェス | `scriptType` 挙動 |
|---|---|
| `publicHead` | `undefined`（デフォルト JS、後方互換）または `'application/ld+json'` を許可 |
| `publicBodyEnd` | `publicHead` と同じ |
| `publicBodyForPost` | `'application/ld+json'` **必須**。他の `scriptType`（または省略）は console warning 付きで drop。投稿単位の任意インライン JS は意図的に閉じており、その必要が出た場合は別の explicit capability で開く設計 |

### プラグインの状態保存

プラグインは複数の仕組みで状態を保持する。どれも「プラグイン 1 つに DynamoDB テーブル 1 つ」ではない：

| 仕組み | 場所 / 形 | 用途 | ステータス |
|---|---|---|---|
| `cms.config.ts` のコンストラクタ引数 | プラグイン factory の引数 | デプロイに焼き込む静的設定 | 現行（Phase 1） |
| `writePublicAsset(key, body, contentType)` | S3 `public/plugins/{instanceId ?? name}/{key}` | 公開サイトがフェッチする生成物：RSS、sitemap XML、JSON インデックス | `trusted` 限定。Phase 3 で capability、key validation、namespace 強制を runtime context 層で正式化。IAM grant は引き続き `public/plugins/*` のバケットワイルドカード |
| `KvStore`（AppSync 経由で admin/editor が書く） | DynamoDB 行 `pk='pluginstate:{plugin}:...'`、TTL 任意 | プラグインがあとで読み直したい小さな状態（カウンタ、最終実行時刻） | 現行 |
| admin 管理の public settings | DynamoDB `pk='siteconfig'`、`sk='plugins.<instanceId>.<fieldKey>'`、 S3 `public/site-settings.json` にミラー | admin が `/admin/plugins` から編集する値。`publicHead` / `publicBodyEnd` の `ctx.setting<T>(key)` から同期読み出し可能。runtime は毎リクエスト `stored → manifest.default → undefined` の順で解決し、admin form 初期表示は `Admin.loadPluginPublicSettings(instanceId)` から取得する。`loadSiteSettings()` (コアサーフェスに限定) とは独立 | Implemented (Phase 2) |
| admin 管理の secret settings | TBD — admin-only AppSync model `PluginSecret` か Secrets Manager / SSM | API キー、署名 secret 等。公開 runtime には絶対に出さない | Planned (Phase 6a) |

上記以外で `private/plugins/` という S3 プレフィックスも `ampless-plugin-data` テーブルも存在しない。プラグインが private 領域を必要とするケースは、将来 privileged 層が解決する。

### S3 レイアウト

```
s3://<bucket>/
  public/
    media/YYYY/MM/<epoch>-<name>          ← アップロードされたメディア
    plugins/{instanceId ?? name}/{key}    ← trusted プラグインの成果物（writePublicAsset）
    static/{slug}/<file>                  ← format: 'static' 投稿のバンドル
    site-settings.json                    ← サイト設定キャッシュ
```

`public/` 以下はバケットポリシー（あるいはメディアの場合は `/api/media/...` プロキシ）から読める。プラグインの書き込みは trusted ランタイムコンテキストにより `public/plugins/{instanceId ?? name}/{key}` に限定される。

### 既存プラグインの Phase 3+ 移行

`ctx.writePublicAsset()` を呼ぶ trusted plugin は capability を宣言してください:

```typescript
capabilities: ['eventHooks', 'writePublicAsset']
```

その plugin が `metadata()` または `siteMetadata()` も実装する場合は、既存 metadata surface の宣言として `metadata` も含める。`metadata` は両方の関数をまとめて表し、別個の `siteMetadata` capability は設けない。

移行期間中、`capabilities` フィールド自体が無い旧 plugin は warn なしで動き続ける。`capabilities` を宣言しているのに `writePublicAsset` を含めない plugin は、実際に `ctx.writePublicAsset()` を呼んだ時だけ runtime で 1 回 warn する。将来の major release ではこの不一致を hard reject する可能性がある。

### capability mismatch 警告一覧

runtime は起動時に宣言と実装の不一致を検出して（エラーではなく）warn する:

| 不一致 | 警告タイミング |
|---|---|
| `writePublicAsset` 宣言済みだが `ctx.writePublicAsset()` 未呼び出し | 初回の宣言ありスタートアップ時 |
| `writePublicAsset` 未宣言だが `ctx.writePublicAsset()` 呼び出し | 初回の呼び出し時 |
| `schema` 宣言済みだが `publicBodyForPost` 未実装 | スタートアップ時 |
| `publicBodyForPost` 実装済みだが `schema` 未宣言 | スタートアップ時 |

### API バージョニング

プラグインは `apiVersion: 1` を宣言する。ampless は理解できないバージョンを拒否する。現状は 1 のみがサポートされており、このフィールドは将来の forward-compat 用フックであって、現時点で分岐に使われてはいない。

```typescript
export default seoPlugin({/* config */}) // → { apiVersion: 1, name: 'seo', ... }
```

### プラグインマニフェスト（npm 公開プラグイン）

サードパーティプラグインは通常の npm tarball として公開し、factory を default export する。「マニフェスト」は factory が返すランタイムオブジェクトそのもので、別に JSON マニフェストファイルは置かない。

### プラグイン間の結合

**正式な cross-plugin 依存機構は設けていない**（`dependsOn` フィールド無し、plugin 同士を引く registry 無し、plugin 間で settings を共有する API 無し）。現状の設計方針は **loose coupling のみ** — 連携が必要なプラグインは、基盤プラグインが populate する client-side global（`window.dataLayer` / `window.gtag` 等）を経由して動く。augmenting plugin 側は **plugin の順序も存在も前提にせず、欠けていたら silently no-op** する書き方を取る — これが依存宣言なしに loose coupling 設計が成立する根拠。GA4 カスタムイベント例の defensive 形は次のような感じ:

```js
if (Array.isArray(window.dataLayer)) {
  window.dataLayer.push({ event: 'newsletter_signup' })
}
```

裸の `window.dataLayer.push(...)` は GA4 未ロード時に throw するので避ける。

これは WordPress / Google Tag Manager の拡張同士が実運用で連携する形と同じで、プラグイン契約をシンプルに保つ。`dependsOn` による順序保証、plugin 間 settings 参照、typed runtime ブリッジといった tight coupling の正式化は **first-party plugin で実需が出るまで保留**。投機的に API を切ると、複数 instance のターゲット指定、trust_level 跨ぎ、失敗モード、循環検出などの判断を、根拠の薄いまま固めることになる。

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
