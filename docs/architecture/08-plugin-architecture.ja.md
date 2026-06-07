> English: [08-plugin-architecture.md](./08-plugin-architecture.md)
> 
## 8. プラグインアーキテクチャ

> **プラグインを書く人向け**: 本ページは設計仕様。実装手順は別ドキュメント [`packages/ampless/docs/plugin-author-guide.ja.md`](../../packages/ampless/docs/plugin-author-guide.ja.md) に集約しています(`ampless` の npm tarball にも同梱されるほか、scaffold したサイトリポジトリの `docs/plugin-author-guide.ja.md` にもコピーされます)。

### Trust model（v1 スコープ）

ampless はエンジニア向けのカスタマイズベース CMS です（[ポジショニング](./14-roadmap.ja.md#ポジショニング2026-06-07)）。プラグインはサイトエンジニアが `cms.config.ts` で直接インポート + 設定する npm dep（Astro integration / Next.js plugin パターン）であり、エンジニアがインストール前に各 dep を審査します。

本節で説明する trust framework（`trust_level` union、IAM スコープ付きの trusted / untrusted Lambda、capability 宣言リスト、`secretSettings` の `trusted` 専用チェック）は v1 において**ファーストパーティプラグインの code organization**として実装されています。決定する内容:

- 各イベントフックがどの trust 階層の Lambda で実行されるか（event-dispatcher → SQS-trusted または SQS-untrusted）
- 各階層の Lambda が保有する IAM 権限（trusted はポストを読み、自分の S3 パスに書き込む; untrusted は権限なし）
- runtime が trust 階層で hard-gate する機能（例: `settings.secret` を宣言するプラグインは `trust_level: 'trusted'` でないと `definePlugin()` 時に throw — シークレット読み取りに `PluginSecret` テーブルへの trusted Lambda の IAM 権限が必要なため）
- runtime / admin が warning・UI ラベル・将来の allow-list に使う capability 宣言（capability 不一致は今日は soft warning; admin UI ラベルは capabilities から読み取る; 将来の `cms.config.ts` allow-list が capabilities に作用する可能性）
- runtime が防御的に sanitize する出力パス（例: `publicHtmlForPost` の可視 HTML に対する厳格 allowlist — trust 階層を問わず同じ sanitize を適用、trust 階層のゲートではなく多層防御）

エンジニアが審査していない任意のサードパーティ untrusted プラグインを自動的に安全に動かすための marketplace-grade automatic sandbox としては**設計されていません**。エンジニアが `cms.config.ts` に追加するプラグインは、エンジニアがインストールを選択したから信頼されるのであり、フレームワークが安全性を保証しているからではありません。マーケットプレイス + ランタイムサンドボックスは v2.0+ の探索項目であり、v1.0 の成果物ではありません（[ロードマップ §v2.0+ exploration](./14-roadmap.ja.md#v20-以降探索のみ--コミットなし) を参照）。

### 設計方針

ampless のプラグインは、自身の `trust_level` に対応するイベント処理 Lambda の中で動く。サンドボックスは **Lambda の IAM 実行ロール**であり、V8 isolate でも `vm.Script` ラッパーでもない。プロセス内 JS サンドボックスは存在しない。untrusted コードは IAM ロールが空の Lambda で走り、trusted コードは trusted 層に必要な権限だけが付いた Lambda で走る。この IAM 分離はファーストパーティ / エンジニア審査済みプラグイン向けのサイズ設計（将来のマーケットプレイスへの forward-compat、§Trust model (v1 scope) 参照）。ファーストパーティの `'untrusted'` プラグインが空の IAM ロールの範囲内で悪意ある振る舞い（例: CPU 消費、フック内での throw）をすることをそれ自体では防がない; エンジニアの審査が最終防衛線であり、フレームワークではない。

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

  // 宣言された capability リスト。runtime は宣言と実装の不一致で warning を出す。
  // `cms.config.ts` の `allowCapabilities` は v2.0+ marketplace 検討用に
  // 予約された future allow-list surface (admin page / server route / secrets 等)
  // であり、現状の runtime では強制されない。本ドキュメント後半の
  // `allowCapabilities` セクション参照。
  capabilities?: readonly PluginCapability[]

  // イベントフック — trust_level に対応する Lambda が SQS から受けて実行
  // 戻り値は予約: `Promise<void | PluginHookResult>`。runtime は現状これを
  // 無視する（`Promise<void>` を返す既存プラグインはそのまま動く）。
  // `PluginHookResult` は forward-compat の予約。
  hooks?: { [K in EventType]?: (event, ctx) => Promise<void | PluginHookResult> }

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

`capabilities` はプラグインが何をしたいかの宣言。runtime / admin が capability / 機能不一致 warning、admin UI ラベル、将来の allow-list surface として使う（runtime は今日 `capabilities` 宣言で機能を hard-gate しない、限られた例外を除いて — 最も重要な例外として `settings.secret` を `trust_level !== 'trusted'` で宣言すると `definePlugin()` 時に throw する、下の capability テーブルの [`secretSettings`](#capability-モデル) 行を参照）。この宣言 surface はファーストパーティ / エンジニア審査済みプラグイン向けのサイズ設計（上記の [Trust model（v1 スコープ）](#trust-modelv1-スコープ) を参照）。

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
| `secretSettings` | `settings.secret` フィールドを 1 つ以上宣言する — admin 編集可能な値を `PluginSecret` DDB テーブル（IAM 専用アクセス; Cognito グループは直接読み取り不可）に暗号化して保存する。admin は `setPluginSecret` / `clearPluginSecret` AppSync mutation（plugin-secret-handler Lambda 経由）で書き込み、Lambda が AES-256-GCM 暗号化してから DDB に書く。trusted フックのみが `ctx.secret<T>(key)` で読み取れる。`definePlugin()` 時に 4 つの observable な挙動がある（[plugin.ts:1004-1019](../../packages/ampless/src/plugin.ts#L1004-L1019)）: (1) **`settings.secret` 非空 + `trust_level !== 'trusted'`** → `definePlugin()` が throw — シークレット読み取りに `PluginSecret` テーブルへの trusted Lambda の IAM 権限が必要; untrusted と privileged Lambda はそのテーブルへの IAM 読み取りアクセスを持たない。(2) **`settings.secret` 非空 + `capabilities` 宣言済み + `capabilities` に `'secretSettings'` が含まれない** → soft 不一致 warning — `'schema'` / `'publicHtmlForPost'` の既存 capability-mismatch パターンと同じ。(3) **`settings.secret` 非空 + `capabilities` 未定義**（`capabilities` 配列を持たない legacy プラグイン）→ warning なし — `capabilities` が `undefined` のとき不一致チェックをスキップ、後方互換のため。(4) **`capabilities: ['secretSettings']` 宣言だけで `settings.secret` フィールドなし** → no-op — warning も throw もなし。 | `trusted` のみ（`settings.secret` が非空のとき `definePlugin()` 時に hard gate; 上記 4 ケース参照）。 |

予約済み capability（名前のみ、実装は後続フェーズ — [docs/tmp/plugin-extension-roadmap.md](../tmp/plugin-extension-roadmap.md) 参照）:

`contentFields` · `adminPage` · `serverRoute` · `network` · `scheduler` · `storageWrite` · `privilegedSystem` · `cspReady`。

`cspReady` は CSP nonce 予約 (`inlineScript.nonce: 'auto'` / `script.nonce: 'auto'` / `PluginPublicRenderContext.cspNonce` と同時 ship、Phase 1: 型のみ、runtime no-op) の declarative-badge 部分。今宣言しても runtime cross-check や warning は出ない。admin UI バッジ + render-time sanity check は middleware/SSR CSP nonce threading PR で landing する。

`allowCapabilities` は `cms.config.ts` runtime の**将来の allow-list surface として予約された**サーフェスです。runtime は今日 capability の allow-listing を強制しない; この項目は v2.0+ マーケットプレイス探索のための planned hook として文書化されており、サイトが untrusted サードパーティプラグインに対して capabilities を宣言的に許可 / 拒否したい場合を想定している。v1 ファーストパーティプラグインはこの surface 経由で何かに opt-in する必要はない。

```typescript
plugins: [
  somePrivilegedPlugin({ ... }, { allowCapabilities: ['serverRoute', 'secretSettings'] }),
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

- **IAM**：Post と GSI に対する `dynamodb:Query` / `Scan`、KvStore に対する `dynamodb:Read`、PluginSecret に対する `dynamodb:GetItem`（read-only; Phase 6a v2 — 書き込みは plugin-secret-handler Lambda 専用）、PostTag に対する `dynamodb:Write`、`public/plugins/*` に対する `s3:PutObject` / `DeleteObject`、加えて組み込みハンドラ用に `public/site-settings.json` への正確一致 grant。
- **ランタイムコンテキスト**：`listPublishedPosts()` は `byStatus` GSI に Query 1 発。`writePublicAsset(key, body, contentType)` は `public/plugins/{instanceId ?? name}/{key}` への書き込み。`ctx.secret<T>(key)` は PluginSecret table から ciphertext を読み取り、`process.env.PLUGIN_SECRET_ENCRYPTION_KEY`（CDK が `amplify/secrets/encryption-key.ts` の値から注入）で AES-256-GCM 復号して plaintext を返す（invocation lifetime で plaintext をキャッシュ、複合キーで cross-plugin 衝突防止）。
- **用途**：SEO メタデータ、RSS フィード生成、sitemap 再構築、独自インデックス維持、admin でローテーション可能な signing secret を使った Webhook 配送。
- **ファーストパーティ例**：`@ampless/plugin-seo`、`@ampless/plugin-rss`、`@ampless/plugin-webhook`（Phase 6b retrofit 後）。

trusted Lambda の S3 grant がプラグイン単位ではなく `public/plugins/*` でバケットワイルドカードなのは意図的：trusted プラグインはファーストパーティ限定なので互いの干渉は脅威モデル外、プラグインごとの enumeration は IAM インラインポリシーの 10 KiB 上限を約 50 プラグインで超える、そしてランタイムコンテキストがキーを plugin instance でネームスペース化しているため、コンテキストを介さない限り隣のプレフィックスには書けない。Phase 3 で `writePublicAsset` を正式化するときもこの分離方針を維持する: **IAM は processor 全体の prefix のみ強制、plugin instance 単位の prefix は runtime context 層で強制**。trusted processor は各 plugin に `instanceId ?? name` に bound された storage handle を渡し、書き込み前に key を検証する（絶対パス、`.` / `..` segment、backslash、制御文字、256 文字超を禁止）。また、`capabilities` を宣言している plugin が `writePublicAsset` を含めずに実際に `ctx.writePublicAsset()` を呼んだ場合は 1 回だけ warn する。`capabilities` 未宣言の旧 plugin は warn なしで動き続ける。プラグインごとに Lambda を分離して capability ベース IAM を発行する大規模再設計は[ロードマップ](./14-roadmap.md)に残るが、Phase 3 のドッグフードで runtime 層の強制が不十分と判明した場合のみ着手する。

#### `privileged`

型として予約済み — 契約上 `trust_level: 'privileged'` は受け取れるが、現状 privileged 用の Lambda は用意されていない。現在のランタイム挙動：

- **イベントフック (`hooks`)**：両 processor（`processor-trusted` と `processor-untrusted`）とも privileged プラグインをフィルタアウトし、フックは実行されない。このフェーズ以降、`definePlugin()` と両 processor は privileged プラグインが `hooks` または `'eventHooks'` capability を宣言している場合に `console.warn` を出力するため、サイレントドロップがコールドスタート・`next dev` 起動・SQS イベント到着時に可視化される。警告はイベントごとに 2 回（processor ごとに 1 回）出るのは設計通りであり、それ自体がフックが全ディスパッチパスでフィルタされているシグナルになる。
- **同期サーフェス**（`publicHead` / `publicBodyEnd` / `metadata` / `publicBodyForPost` / `publicHtmlForPost`）：公開 Next.js プロセス内で動作し、**`trust_level` でゲートされない** — 同期サーフェスのみを実装した privileged プラグインは今日から警告なしで正常に動く。

**現時点で `trust_level: 'privileged'` とイベントフックを宣言した場合、フックは実行されない。** 型として受け入れるのは将来の意図を宣言できるようにするためであり、警告が privileged Lambda が用意されるまでのシグナルとなる。

**v2.0+ 探索のみ — ampless がプラグインマーケットプレイスを必要とする場合**: エンジニアが審査していないサードパーティプラグインを安全に動かすマーケットプレイスが必要になった場合にのみ、プラグインごとの Lambda + capabilities ベース動的 IAM として実装する。意図する形は将来の探索の参考として以下に記述する。コミット済みの v1.0 成果物ではない。v1 ファーストパーティプラグインは `trust_level: 'trusted'` を宣言し、trusted Lambda の現行 IAM スコープ内（Post / KvStore / PluginSecret / PostTag 読み取り + `public/plugins/*` S3 書き込み + 外向き HTTP — 本ドキュメント前半の IAM スコープ図を参照）で動くものに留める。このスコープ外の要件（SES、private S3 プレフィックス、AWS IAM プリンシパルが必要な外部 API 等）は v2.0+ privileged Lambda 探索の対象として下記に列挙されており、v1 `trusted` には収まらない。

想定される将来形（マーケットプレイス探索の参考用のみ）：

- privileged プラグイン 1 つにつき 1 Lambda。
- プラグインが capability リストを宣言し、CDK がそれを IAM ポリシーに展開する。
- 用途：メール送信（SES）、独自テーブルへのフォーム投稿保存、外部の有料 API 呼び出し、private S3 プレフィックスへのアクセス。

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
- `inlineScript`（id 必須、body 文字列。CSP nonce: API サーフェス予約済み（Phase 1 no-op）。3 層 opt-in 設計が整備済み — `PluginPublicRenderContext` の `ctx.cspNonce`（今のところ常に `undefined`）、descriptor の `inlineScript.nonce: 'auto'` / `script.nonce: 'auto'`（型として受け入れ、まだ伝搬なし）、name-only `'cspReady'` capability（declarative バッジ）。runtime スタンプは middleware/SSR CSP nonce threading PR とともに landing する）
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
| admin 管理の secret settings | `PluginSecret` DDB テーブル（IAM 専用 AppSync 認証 — Cognito グループは直接アクセス不可）。`sk`（`plugins.<instanceId>.<fieldKey>`）で識別。`value` 列は **AES-256-GCM ciphertext**（base64; フォーマット: `IV[12] \|\| ciphertext \|\| authTag[16]`）。暗号化キーは `amplify/secrets/encryption-key.ts`（`npx create-ampless setup-encryption-key` で生成、`amplify/backend.ts` と同じ階層）に保存し、`defineAmplessBackend({ pluginSecretEncryptionKey })` 経由で CDK が Lambda env var `PLUGIN_SECRET_ENCRYPTION_KEY` に注入する — DDB には保存しない。**脅威モデル（Phase 6a v2.2）**: DDB テーブルを読める AWS Console オペレータが見るのは ciphertext のみ（✓ 対策済み）。ソースリポジトリやデプロイアーティファクトへのアクセスがあれば鍵を取得できる（⚠ 対策なし — リポジトリは private に保つか `--gitignore` で鍵を外部配布する）。同じ Lambda プロセス内で動く悪意ある trusted plugin は `process.env.PLUGIN_SECRET_ENCRYPTION_KEY` を読める（✗ 対策なし — per-plugin Lambda 分離はロードマップ）。admin 書き込みパス: admin ブラウザ → `setPluginSecret` / `clearPluginSecret` AppSync mutation → plugin-secret-handler Lambda が検証・env var から鍵取得・暗号化・DDB PutItem → 平文は DDB に保存されずブラウザにも返らない。存在チェック: admin ブラウザは `PluginSecretIndicator`（admin/editor-accessible, `lastSetAt` のみ保持）を読む。hook 側読み取り: `ctx.secret<T>(key)`。初期設定: `npx create-ampless setup-encryption-key` で鍵ファイルを生成してからデプロイ（AWS 認証情報不要）。S3 mirror 経路には流れない。**Dual-write 整合性**: set/clear は 2 テーブルに連続して書く。2 回目の書き込みが失敗すると予測可能な状態が残る — set パス部分失敗は「secret は機能するが indicator なし（UI は「未保存」と誤表示）」; clear パス部分失敗は「indicator が stale だが secret は削除済（UI は「保存済み」と誤表示、secret は実際には発火しない）」。 | 実装済み (Phase 6a + Phase 6a v2.2)。`trust_level: 'trusted'` + `'secretSettings'` capability 必須。 |

上記以外で `private/plugins/` という S3 プレフィックスも `ampless-plugin-data` テーブルも存在しない。プラグインが private 領域を必要とするケースは、将来 privileged 層が解決する。

### プラグインが所有するデータ領域

プラグインが所有するデータは以下の 5 領域に置かれる可能性があり、**現状の書き込み経路は領域ごとに異なります**。3 つのファミリに分かれます:

- **KvStore** — admin/editor が AppSync 経由で書き込みます。プラグインの hook には KvStore write helper は提供されていません。
- **PluginSecret + PluginSecretIndicator** — `plugin-secret-handler` Lambda が書き込みます。admin/editor が `setPluginSecret` / `clearPluginSecret` AppSync mutation を呼ぶと、handler Lambda が DDB に書く流れです。trusted processor は `ctx.secret<T>()` で `PluginSecret` を読み取りますが、どちらの secret テーブルにも書き込みません。
- **S3 `public/plugins/{instanceId ?? name}/*`** — trusted Lambda の hook context (`ctx.writePublicAsset(...)`) から書き込みます。プラグインの hook が直接書き込めるのはこの領域だけです。
これら以外 — `Post`、`Page`、`Media`、`PostTag` DynamoDB テーブル、`public/site-settings.json` S3 ミラー、他プラグインの namespace — への書き込みは禁止です。現状 runtime が強制しているわけではなく、信頼（および将来の IAM 強化）によって担保されます。

| 領域 | パス / 識別子 | アクセスレベル | Phase |
|---|---|---|---|
| KvStore（admin 設定） | DynamoDB `pk='siteconfig'`、`sk='plugins.<instanceId>.<fieldKey>'` | admin/editor が AppSync 経由で書く（プラグインの hook context には KvStore write helper は現状提供されていない） | Phase 2 |
| KvStore（runtime 状態/キャッシュ） | DynamoDB `pk='pluginstate:<plugin>:...'`（TTL 任意） | admin/editor が AppSync 経由で書く（プラグインの hook context には KvStore write helper は現状提供されていない） | 現行 |
| PluginSecret | DynamoDB `PluginSecret` テーブル、`sk='plugins.<instanceId>.<fieldKey>'` | `trusted` 限定（IAM 専用 AppSync 認証） | Phase 6a |
| PluginSecretIndicator | DynamoDB `PluginSecretIndicator` テーブル、`sk='plugins.<instanceId>.<fieldKey>'` | `trusted` + admin/editor（indicator 読み取り） | Phase 6a |
| S3 プラグイン成果物 | `public/plugins/{instanceId ?? name}/*` | `trusted` 限定（`writePublicAsset`） | Phase 3 |

注記:

- **cleanup は自動ではありません。** `cms.config.ts` からプラグインを外しても、これら 5 領域のデータは自動削除されません。孤立データはオペレータが手動で削除するまで残ります。`uninstall` lifecycle hook（`packages/ampless/src/plugin.ts` の `AmplessPlugin.uninstall` 参照）は、将来の lifecycle-dispatch PR で起動メカニズムを追加するために予約されています。その PR がリリースされるまで、cleanup はオペレータの責任です。
- **独自 DynamoDB テーブル。** プラグインが ampless スキーマ外に独自の DynamoDB テーブルを持つ場合（サイトローカル CDK construct 経由など）、そのテーブルの lifecycle 管理（アンインストール時の cleanup を含む）はプラグイン著者が完全に責任を持ちます。ampless は外部テーブルを把握しておらず、`uninstall` フック cleanup の IAM grant は上記 5 領域のみをカバーします。
- **将来の lifecycle-dispatch PR。** その PR がリリースされると、trusted Lambda IAM ポリシーの cleanup grant がこれら 5 領域に限定されます。今日空の `uninstall` ボディを宣言したプラグインは自動的に呼び出しイベントを受け取ります。実際の cleanup ボディを追加するには再パブリッシュが必要です。

### settings の形状変化（Phase 1 予約）

`PluginSettingsManifest.version?: number` は予約済みです。現状 runtime はこのフィールドを読みません。形状変化は silently 吸収されますが、実際の挙動は `public` と `secret` で異なります。両者は完全に別の write/read パスを使っているためです:

- **`settings.public`** は `resolvePluginSettings`（[packages/ampless/src/plugin-settings.ts](../../packages/ampless/src/plugin-settings.ts)）から読まれます。`manifest.public` のみをイテレートし、field ごとに `field.default` にフォールバックします。フィールド追加は `default` から解決、削除は KvStore に orphan row として残り resolver が silently skip、型変更は検証失敗時に `default` へフォールバック。
- **`settings.secret`** は `resolvePluginSettings` から一切読まれません。admin UI が `setPluginSecret` AppSync mutation 経由で値を 1 つずつ書き（`plugin-secret-handler` Lambda が暗号化して `PluginSecret` に格納）、trusted hook が `ctx.secret<T>(key)` で key 単位で直接 `PluginSecret` から復号読み取りします。`PluginSecretField` 型は `default` を持てません（型レベル禁止）。manifest レベルのフォールバックは存在しません。フィールド削除では暗号化された orphan row が残り、どの resolver も走らない（operator が手動で cleanup する領域）。改名では旧 key の ciphertext が orphan になり、admin が新 key で値を入れ直す必要があります。型変更は admin write 時の validation のみに影響し、既存の ciphertext は read 時には影響を受けません。

この予約は、将来の migration PR が「manifest の version vs ストレージの version」のミスマッチを検出して反応できるようにするためのものです。version の保存先、比較タイミング、ミスマッチ時の挙動はすべてその future PR の設計領域であり、その PR は public 側の resolver パスと secret 側の direct-read パスの両方をカバーする必要があります。将来の検出パスに参加したいプラグイン著者は、今日から `version: 1` を宣言しておくことができます。

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

### apiVersion bump policy

#### apiVersion の役割

`apiVersion` はプラグイン契約の **load-bearing breaking-change marker** です。「このプラグインは ampless plugin API の特定の安定した shape に対してビルドされた」ことを示します。runtime は `package.json#amplessPlugin.apiVersion` とファクトリが返す値の両方をクロスチェックし、`SUPPORTED_API_VERSION` を超える値を宣言したマニフェストも含め、**mismatch があれば hard-throw** します。

#### 現状

現在サポートされているのは `apiVersion: 1` のみです。`AmplessPlugin` の literal type `apiVersion: 1`（[packages/ampless/src/plugin.ts](../../packages/ampless/src/plugin.ts)）は compile-time に他の値を拒否し、`SUPPORTED_API_VERSION = 1 as const`（[packages/runtime/src/plugin-package-manifest.ts](../../packages/runtime/src/plugin-package-manifest.ts)）が runtime のゲートです。

```typescript
export default seoPlugin({/* config */}) // → { apiVersion: 1, name: 'seo', ... }
```

#### Additive vs breaking (境界線)

**Additive（`apiVersion: 1` 内に収まる）**:

- `AmplessPlugin` への新しい optional field 追加（例: `uninstall?`、`settings.version?`）
- 新しい reserved capability 名の追加（例: `cspReady`）
- 既存 context 型への新しい optional field 追加（例: `PluginPublicRenderContext` の `cspNonce?`）
- 既存 descriptor への新しい optional field 追加（例: inline / external script の `nonce?`）
- 既存実装に対して covariant な hook 戻り値型の widening（例: `Promise<void>` → `Promise<void | PluginHookResult>`）
- union への新しい reserved trust level 追加（例: `'privileged'` は #230 以前から union に存在したが、silent-drop として扱われていた）
- 既存プラグインを拒否せずに warning を出すだけの runtime 動作変更（例: PR #230 privileged visibility）
- 既存プラグインが declare する必要のない新しい docs / type reservation の追加

**Breaking（`apiVersion: 2` が必要になる）**:

- `AmplessPlugin` 上の既存 required field の削除またはリネーム
- `AmplessPlugin` への新しい required field 追加（optional ではなく）
- 既存の hook surface の call signature 変更（例: event hooks、render surfaces、lifecycle hooks）
- 既存 capability の semantic 意味の変更（新しいものを追加するのではなく）
- descriptor variant の削除またはリネーム
- すでに動いているプラグインの実行を落とす形での trust_level semantics の締め付け（#230 で追加された explicit-warn-then-drop visibility とは対照的で、それは silent-drop 動作を維持しつつ warning を追加するだけ）
- lenient public resolver が吸収できず、かつ新しい `version` reservation だけでは対処できない形での `PluginSettingsManifest` field shape 変更

#### Phase 1–6a reservation の状態

5 件の compat-break protection PR（#220 CSP nonce、#222 PluginHookResult、#230 privileged visibility、#232 uninstall + ownership、#234 settings.version）はすべて **`apiVersion: 1` 内** に収まります。上記の additive 基準に従っているため、契約バージョンの bump は不要でした。現在 `apiVersion: 1` を宣言して新しい reservation を使わないプラグインは、型チェックを通過しそのまま動き続けます。

#### Beta 期間のポリシー

beta 期間中（npm dist-tag `beta`、リポジトリ公開、外部プラグイン作者が積極的に publish）は、**`apiVersion` は `1` に固定**されます。個別の npm パッケージバージョン（`ampless@1.0.0-beta.x`、`@ampless/runtime@1.0.0-beta.x` など）は changeset 経由で自由に bump されますが、プラグイン**契約**バージョンは beta 中に bump しません。この保証は npm dist-tag の切り替えとは独立しており、beta 期間中にプラグイン作者が頼れる約束です。

#### Dual-version support（deferred）

`apiVersion: 2` をサポートする将来の runtime が `apiVersion: 1` のプラグインも引き続き受け入れるか（dual-version 共存）、ハードカットするか（`2` のみ受け付け）は、**v2 PR 自身が決める**設計上の判断です。このドキュメントはどちらも約束しません。現在の `SUPPORTED_API_VERSION` は単一の `as const` 値であり、複数をサポートするには range または set への変更が必要で、それは v2 とともに ship する runtime 変更です。

#### 将来の `apiVersion: 2` の候補 trigger

以下のリストは **committed roadmap ではなく judgment material** です。各項目は、**現在の形で実施された場合**、上記の breaking 基準を満たす変更です。スケジュールはなく、保証もなく、v2 PR（いつ来るとしても）がどのサブセットが実際に契約 bump を必要とするかを決めます:

- **Privileged Lambda プロビジョニング** — PR #230 は `trust_level: 'privileged'` に warning のみの visibility を追加しました。すでに `'privileged'` を宣言しているプラグインの hook 実行 semantics を変える形での、独自 IAM ロールを持つ privileged Lambda の実際のプロビジョニングは、`apiVersion: 2` の候補です。
- **Plugin lifecycle dispatch** — PR #232 は `AmplessPlugin.uninstall?` と `PluginUninstallContext` を reserved しました。runtime path から `uninstall` を呼び出し context に cleanup helper を追加する実際の lifecycle-dispatch PR は、設計通り（`uninstall?` は optional、helper は専用 context 上）に landing すれば **additive** です。ただし設計上 event hook が使う `PluginRuntimeContext` を拡張する必要が出た場合は、breaking change になります。
- **Settings shape migration mechanism** — PR #234 は `PluginSettingsManifest.version?` を reserved しました。将来の `migrate` hook（または同等の surface）は、`AmplessPlugin` への新しい optional field として ship すれば **additive** です。ただし migration mechanism が `resolvePluginSettings` の戻り値の変更を必要とする場合（例: migration 前の値を plugin コードに expose する）は breaking になります。
- **CSP nonce stamping をミドルウェア経由で配線** — PR #220 は `ctx.cspNonce`、`descriptor.nonce: 'auto'`、`'cspReady'` capability を reserved しました。additive に landing する実際の stamping（`ctx.cspNonce` が populate されたときに runtime が `descriptor.nonce` を読み始める）は v2 不要です — それが reservation の要点です。ただし stamping がどのスクリプトをレンダリングするかを変える場合（例: CSP-on 時に常にスクリプトを除去）は breaking になります。
- **すでに動いているプラグインの trust_level semantics を締め付けるあらゆる変更**（新しい tier を opt-in で追加するのではなく）は v2 候補です。

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
