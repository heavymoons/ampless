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

  // 投稿単位の可視 HTML。テーマの post ページが beforeContent / afterContent
  // スロットに render する。本文は runtime が sanitize-html の厳格 allowlist で
  // 必ず sanitize する。
  // Phase 6d (実装済み)。capability: `publicHtmlForPost`。
  publicHtmlForPost?(post: Post, ctx): readonly PublicPostHtmlDescriptor[]

  // 動的 OG 画像 — リクエスト時に Next.js ImageResponse でレンダリング
  ogImage?: OgImageConfig
}
```

`capabilities` / `instanceId` / `displayName` / `publicHead` / `publicBodyEnd` は **Phase 1 拡張**にあたるフィールドで、型追加は Phase 1 spec ([docs/tmp/plugin-extension-spec.md](../tmp/plugin-extension-spec.md)) の範囲。`publicBodyForPost` は **Phase 4 拡張** — 投稿単位の body 注入、主に JSON-LD 構造化データ向け。`publicHtmlForPost` は **Phase 6d 拡張** — 投稿単位の可視 HTML で、reading-time badge / breadcrumb / share link 等を想定。既存ファーストパーティプラグイン (`seo` / `rss` / `og-image` / `webhook`) はこれらを宣言しなくても動作し続ける。

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

Phase 6d で追加:

| capability | 意味 | 既定許可 trust_level |
|---|---|---|
| `publicHtmlForPost` | `publicHtmlForPost()` — テーマの post ページの `beforeContent` / `afterContent` スロットに **可視 HTML** を注入する (Phase 6d、実装済み)。body は runtime が `sanitize-html` の厳格 allowlist で sanitize する。`trust_level` を問わず同じ sanitize を強制 | `untrusted` 以上 |

Phase 6a で追加:

| capability | 意味 | 既定許可 trust_level |
|---|---|---|
| `secretSettings` | `settings.secret` フィールドを宣言し、`PluginSecret` DDB テーブル（IAM 専用; Cognito グループのアクセス不可）に暗号化して保存する。admin は `setPluginSecret` / `clearPluginSecret` AppSync mutation（plugin-secret-handler Lambda 経由）で書き込み、Lambda が AES-256-GCM 暗号化を行ってから DDB に書く。trusted Lambda のみが `ctx.secret<T>(key)` で復号読み取りできる。`trust_level: 'trusted'` 必須。 | `trusted` のみ — untrusted プラグインがこれを宣言すると `definePlugin()` 時に throw する。 |

予約済み capability（名前のみ、実装は後続フェーズ — [docs/tmp/plugin-extension-roadmap.md](../tmp/plugin-extension-roadmap.md) 参照）:

`contentFields` · `adminPage` · `serverRoute` · `network` · `scheduler` · `storageWrite` · `privilegedSystem`。

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

- **IAM**：Post と GSI に対する `dynamodb:Query` / `Scan`、KvStore に対する `dynamodb:Read`、PluginSecret に対する `dynamodb:GetItem`（read-only; Phase 6a v2 — 書き込みは plugin-secret-handler Lambda 専用）、PostTag に対する `dynamodb:Write`、`public/plugins/*` に対する `s3:PutObject` / `DeleteObject`、加えて組み込みハンドラ用に `public/site-settings.json` への正確一致 grant。
- **ランタイムコンテキスト**：`listPublishedPosts()` は `byStatus` GSI に Query 1 発。`writePublicAsset(key, body, contentType)` は `public/plugins/{instanceId ?? name}/{key}` への書き込み。`ctx.secret<T>(key)` は PluginSecret table から ciphertext を読み取り、`process.env.PLUGIN_SECRET_ENCRYPTION_KEY`（CDK が `amplify/secrets/encryption-key.ts` の値から注入）で AES-256-GCM 復号して plaintext を返す（invocation lifetime で plaintext をキャッシュ、複合キーで cross-plugin 衝突防止）。
- **用途**：SEO メタデータ、RSS フィード生成、sitemap 再構築、独自インデックス維持、admin でローテーション可能な signing secret を使った Webhook 配送。
- **ファーストパーティ例**：`@ampless/plugin-seo`、`@ampless/plugin-rss`、`@ampless/plugin-webhook`（Phase 6b retrofit 後）。

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
| `publicHtmlForPost` | 公開 Next.js プロセス — テーマの post ページテンプレート | 投稿単位の描画時。`pages/post.tsx` から呼ばれる。body は `sanitize-html` の厳格 allowlist で sanitize され、`beforeContent` / `afterContent` スロットに embed される |
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

### `publicHtmlForPost` — 投稿単位の可視 HTML

`publicHtmlForPost(post, ctx)` は、テーマが post 本文の周囲に embed する **可視 HTML** descriptor を返す。v1 で提供するスロットは 2 つ:

| `position` | テーマでの位置 |
|---|---|
| `'beforeContent'` | post 本文 (`renderBody(post)`) の直前 — 用途例: reading-time バッジ、breadcrumb、byline |
| `'afterContent'` | post 本文の直後 — 用途例: share リンク、関連記事、edit-on-GitHub footer |

hook は sync (`readonly PublicPostHtmlDescriptor[]`) で、`publicBodyForPost` と同じ規約。テーマは `await ampless.publicHtmlForPost(post)` を呼び（settings の取得があるので Promise）、`{html.beforeContent}` / `{html.afterContent}` をそのまま JSX に embed する。sanitize / wrapper / dedupe / namespace 解決はすべて runtime に閉じており、テーマ側で `dangerouslySetInnerHTML` を書く必要はない。

**Sanitizer (`sanitize-html` strict profile)。** descriptor の body は `trust_level` に関係なく `sanitize-html` を通る。allowlist:

- タグ: `p` · `span` · `strong` · `em` · `a` · `code` · `br` · `ul` · `ol` · `li`
- グローバル属性: `class` · `data-words` · `data-minutes` · `data-ampless-*`
- `<a>` 属性: `href` · `rel` · `target`
- `href` で許可するスキーム: `http` / `https`（さらに相対 `./path` / `../path` / `/path` / `#anchor` — scheme なし URL は素通り）
- `target="_blank"` のとき sanitizer が `rel="noopener noreferrer"` を自動付与

明示的に禁止: `<img>` · `<iframe>` · `<video>` · `<audio>` · `<object>` · `<embed>` · `<form>` · `<style>` · インライン `style` 属性 · 全 event handler (`on*`) · `data:` / `javascript:` / `vbscript:` / `mailto:` / `tel:` スキーム。trust level 別の pass-through (生 HTML) escape hatch は v1 では提供しない — 必要になった時に別の明示 capability として開く。

**`id` は plugin-local。** descriptor は短い `id`（例: `'display'`）を持ち、dedupe と React `key` に使う。plugin 作者が自前で namespace を埋め込む必要はない — runtime が wrap 時に `${instanceId ?? name}:${id}` で解決する。validator は `id` が空、制御文字を含む、64 文字超のいずれかなら descriptor を drop + dev warn する。

**dedupe は position ごと。** `beforeContent` と `afterContent` はそれぞれ独立した seen-id セットを持ち、dedupe key は `${namespace}:${id}`。1 つの plugin instance が両 position に同じ `'display'` を返すと両方残る；異なる namespace の 2 plugin instance が同 position に `'display'` を返すと namespace が違うので両方残る；同じ plugin instance が同 position に `'display'` を 2 回返すと最初の 1 件を残して 2 件目を warn 付きで drop。

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
| admin 管理の secret settings | `PluginSecret` DDB テーブル（IAM 専用 AppSync 認証 — Cognito グループは直接アクセス不可）。`siteId` + `sk`（`plugins.<instanceId>.<fieldKey>`）で識別。`value` 列は **AES-256-GCM ciphertext**（base64; フォーマット: `IV[12] \|\| ciphertext \|\| authTag[16]`）。暗号化キーは `amplify/secrets/encryption-key.ts`（`npx create-ampless setup-encryption-key` で生成、`amplify/backend.ts` と同じ階層）に保存し、`defineAmplessBackend({ pluginSecretEncryptionKey })` 経由で CDK が Lambda env var `PLUGIN_SECRET_ENCRYPTION_KEY` に注入する — DDB には保存しない。**脅威モデル（Phase 6a v2.2）**: DDB テーブルを読める AWS Console オペレータが見るのは ciphertext のみ（✓ 対策済み）。ソースリポジトリやデプロイアーティファクトへのアクセスがあれば鍵を取得できる（⚠ 対策なし — リポジトリは private に保つか `--gitignore` で鍵を外部配布する）。同じ Lambda プロセス内で動く悪意ある trusted plugin は `process.env.PLUGIN_SECRET_ENCRYPTION_KEY` を読める（✗ 対策なし — per-plugin Lambda 分離はロードマップ）。admin 書き込みパス: admin ブラウザ → `setPluginSecret` / `clearPluginSecret` AppSync mutation → plugin-secret-handler Lambda が検証・env var から鍵取得・暗号化・DDB PutItem → 平文は DDB に保存されずブラウザにも返らない。存在チェック: admin ブラウザは `PluginSecretIndicator`（admin/editor-accessible, `lastSetAt` のみ保持）を読む。hook 側読み取り: `ctx.secret<T>(key)`。初期設定: `npx create-ampless setup-encryption-key` で鍵ファイルを生成してからデプロイ（AWS 認証情報不要）。S3 mirror 経路には流れない。**Dual-write 整合性**: set/clear は 2 テーブルに連続して書く。2 回目の書き込みが失敗すると予測可能な状態が残る — set パス部分失敗は「secret は機能するが indicator なし（UI は「未保存」と誤表示）」; clear パス部分失敗は「indicator が stale だが secret は削除済（UI は「保存済み」と誤表示、secret は実際には発火しない）」。 | 実装済み (Phase 6a + Phase 6a v2.2)。`trust_level: 'trusted'` + `'secretSettings'` capability 必須。 |

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
| `publicHtmlForPost` 宣言済みだが `publicHtmlForPost` 未実装 | スタートアップ時 |
| `publicHtmlForPost` 実装済みだが `publicHtmlForPost` 未宣言 | スタートアップ時 |

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

### Consent Convention

Cookie バナーを表示するだけでは不十分です。analytics プラグインが無条件にロードされると、訪問者が同意する前から発火してしまいます。Consent Convention は `window.amplessConsent` をプラグイン横断の標準グローバル API として定め、2 つの標準 DOM イベントとともに規約化することで、analytics プラグインがバナープラグインと密結合することなく自身を同意までゲートできるようにします。

リファレンス実装は [`@ampless/plugin-cookie-consent`](../../packages/plugin-cookie-consent/README.ja.md) です。

#### API surface

```ts
interface AmplessConsentGlobal {
  /** 同期チェック — カテゴリが同意済みなら true を返す。 */
  has(category: string): boolean
  /**
   * ユーザがこのカテゴリに対して明示的な決定（accept または reject）を
   * 行ったか? `state[cat] === true` でも `state[cat] === false` でも true
   * を返し、localStorage の state に key が存在しない場合のみ false。
   * 同意バナーを再訪問時に表示するか判定する際は `has` ではなく **これ**
   * を使う — 「保存済みの false」は明確な決定であって「未決定」ではない。
   */
  isSet(category: string): boolean
  /**
   * カテゴリへの初回同意時に発火するコールバックを登録する。
   * すでに同意済みの場合は即時発火（one-shot セマンティクス）。
   * unsubscribe 関数を返す。
   */
  on(category: string, cb: () => void): () => void
  /**
   * 内部用 — バナー UI が呼ぶ。状態更新・localStorage 保存・
   * `ampless:consent-changed` dispatch・pending on() コールバックの発火を行う。
   */
  set(category: string, granted: boolean): void
}
declare global {
  interface Window { amplessConsent?: AmplessConsentGlobal }
}
```

**`has` と `isSet` の使い分け:**
- 同意に gate される analytics plugin は `has`（と `on`）を使う — 同意済みの時だけ発火する。
- バナー UI 自身は `isSet` を使って表示判定する — 一度 reject されたカテゴリも「決定済み」であり、再度プロンプトすべきではない。

#### 標準イベント

いずれも `window` 上で発火します:

- **`ampless:consent-ready`** — install script が `window.amplessConsent` を定義し localStorage の state を restore した直後に 1 度だけ発火。install script より先にロードされた analytics plugin は、このイベントで `has()` / `on()` が使えるタイミングを知る。
- **`ampless:consent-changed`** — `set()` を呼ぶたびに発火。`CustomEvent`、`detail: { category: string, granted: boolean }`。

#### localStorage

同意状態はキー `'ampless:consent'` に `Record<string, boolean>` の 1 行 JSON として保存されます。essential カテゴリは毎ページロード時に install script が `true` で強制上書きし、保存値を上書きします。

#### analytics プラグイン側の consume パターン

`consentCategory` をサポートする analytics プラグインは次の形のスクリプトを埋め込みます:

```js
var initialized = false
function init() {
  if (initialized) return  // 二重初期化防止
  initialized = true
  // … analytics をロード（script 要素作成、gtag 呼び出し等）
}
function wait() {
  if (window.amplessConsent.has(<CATEGORY>)) init()
  else window.amplessConsent.on(<CATEGORY>, init)
}
if (window.amplessConsent) {
  wait()
} else {
  window.addEventListener('ampless:consent-ready', wait, { once: true })
  setTimeout(function() {
    if (!window.amplessConsent) {
      console.warn('[ampless:<plugin>] consentCategory is set but window.amplessConsent never installed. Did you forget to register @ampless/plugin-cookie-consent?')
    }
  }, 5000)
}
```

`initialized` guard は、localStorage restore 経由（`has()` が即 true）と `on()` / `ampless:consent-ready` 経由の両経路が重なった場合の二重初期化を防ぎます。5 秒タイムアウト warning は production でも発火します。これは意図的で、`cookieConsentPlugin` の登録漏れ（運用ミス）を確実に検出するためです。

fail-closed 契約: `consentCategory` を設定した analytics プラグインが `window.amplessConsent` を見つけられなかった場合、トラッキングは**永久に発火しません**。これは GDPR/ePrivacy の観点で正しい安全側の挙動です。

#### 登録順

ampless の `ScriptStrategy` には `beforeInteractive` がないため、同意 install script も analytics プラグインスクリプトも `afterInteractive` で動きます。`cms.config.ts` での登録順がスクリプトの実行順になるため、`cookieConsentPlugin()` を analytics プラグインより**先に**登録してください:

```ts
plugins: [
  cookieConsentPlugin(),          // window.amplessConsent を先にインストール
  analyticsGa4Plugin({ ... }),    // window.amplessConsent を参照する
]
```

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
