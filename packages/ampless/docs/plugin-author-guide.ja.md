<!--
  Source of truth lives in packages/ampless/docs/plugin-author-guide.md.
  Keep both copies in sync — the scaffold copy at
  templates/_shared/docs/plugin-author-guide.ja.md must mirror this file
  byte-for-byte until we add a CI check.
-->

> English: [plugin-author-guide.md](./plugin-author-guide.md)

# ampless プラグインの書き方

このガイドは、初めての `definePlugin()` 呼び出しから admin 編集可能な設定パネル、そして npm 公開に至るまで、ampless プラグインを ship するために必要な手順を一通りカバーします。Phase 1〜4 の機能を網羅 — descriptor ベースの `<head>` / `<body>` / 投稿単位 body 注入、非同期イベントフック、admin 管理の `settings.public` 値です。

設計の経緯と背景は [`docs/architecture/08-plugin-architecture.md`](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.md) に集約。本ページはその実装ハンドブック側です。

---

## 0. テーマとプラグインの境界線

ampless はテーマとプラグインの両方を提供します。用途に合ったものを選ぶことで、未来の自分や他のサイト作者が迷わずコードを見つけられます。

| やりたいこと | テーマを使う | プラグインを使う |
|---|---|---|
| レイアウト・タイポグラフィ・配色・ルート単位の UI | ✓ | |
| home / post / tag ページのカスタムコンポーネント | ✓ | |
| 非開発者が admin から編集できる設定 | | ✓ (`adminSettings`) |
| コンテンツイベント後のバックグラウンド処理（RSS・検索インデックス・webhook） | | ✓ (`eventHooks`) |
| 信頼できる副作用（S3 書き込み・外部 API 送信） | | ✓ (`writePublicAsset` + `trusted`) |
| テーマに依存しない `<head>` / `<body>` 注入（アナリティクス・同意バナー） | | ✓ (`publicHead` / `publicBodyEnd`) |
| 投稿単位の機械可読メタデータ（JSON-LD 等） | | ✓ (`schema` via `publicBodyForPost`) |
| 投稿本文の周囲の可視 HTML（reading-time、breadcrumb、share など） | | ✓ (`publicHtmlForPost`) |
| 複数の ampless サイトで共有したいコード | | ✓ (npm パッケージとして公開) |

判断の目安:

- テーマ = **ページの見た目**。render 時は読み取り専用。
- プラグイン = **render を超えて起こること**: admin 編集可能な設定、バックグラウンド処理、テーマ非依存の注入、機械可読メタデータ、サイト間の再利用。

新しいプラグイン作者がよく踏む 2 つの境界線:

- **ストレージ / DynamoDB / 外部 API 書き込みはプラグインに置く**。テーマは読み取り専用です。
- **admin が `/admin/plugins` からオン・オフしたい機能はプラグインに置く**。表面上の効果が純粋に見た目だけであっても同様です。テーマも独自の設定を持てますが、それはテーマ表示設定であり、サイト運用設定ではありません。

境界線上に本当に乗っている機能については [`docs/architecture/08-plugin-architecture.md`](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.md) で詳しく議論しています。

---

## 1. プラグインで何ができるか

ampless プラグインは 3 つのいずれかの場所に書きます — コードをどのくらい広く共有したいかに応じて選んでください:

| どこに置くか | 使い時 | 置き場所 |
|---|---|---|
| **ファーストパーティ** | ampless コアへの全員向け貢献 | ampless モノレポ内の `packages/plugin-*/` |
| **サイトローカル** | サイト固有のカスタマイズ、個別 publish 不要 | サイトリポジトリ内の `plugins/<name>/` |
| **外部 npm パッケージ** | 他のサイトと共有したい、`npm publish` 想定 | スタンドアロンリポジトリ (`@scope/ampless-plugin-foo`) |

3 つの形式はすべて同じ `definePlugin({...})` ファクトリを呼び出し、同じサーフェスを使います。違いはパッケージング・配布方法、および静的 `package.json#amplessPlugin` マニフェストが有効にするインストール時バリデーションのオプトインです（§3 参照）。

§14 には一行のスキャフォールドコマンド (`npx create-ampless plugin <name>`) があり、後者 2 つのどちらにも即使えるボイラープレートを生成します。

ampless プラグインは `AmplessPlugin` オブジェクトを返す TypeScript モジュールです。以下のうち 1 つ以上のサーフェスにフックします:

| サーフェス | 実行場所 | 同期 / 非同期 | Phase |
|---|---|---|---|
| `metadata(post, site)` | 投稿の `generateMetadata()` | 同期 | 既存 |
| `siteMetadata(site)` | root layout の `generateMetadata()` | 同期 | 既存 |
| `publicHead(ctx)` | root layout の `<head>` | 同期 (async layout から呼ばれる) | 1 |
| `publicBodyEnd(ctx)` | root layout の `<body>` 末尾 | 同期 | 1 |
| `publicBodyForPost(post, ctx)` | テーマの post ページテンプレート（投稿単位） | 同期 | 4 |
| `publicHtmlForPost(post, ctx)` | テーマの post ページテンプレート（投稿単位、可視 HTML） | 同期 | 6d |
| `ogImage` | `/og/[slug]` ルート | リクエスト時、公開 Lambda 内 | 既存 |
| `hooks` | trust_level に応じた processor Lambda | 非同期、SQS イベントで起動 | 既存 |
| `settings.public` | `/admin/plugins` フォーム | 宣言的なマニフェスト | 2 |

後続フェーズに残してある surface もいくつかあって、現状の `definePlugin`
では形にできません:

- **任意の `ReactNode` のページ注入**。同期描画 surface (`publicHead` /
  `publicBodyEnd` / `publicBodyForPost`) は descriptor 変種を返すだけ。
  descriptor の validator は **runtime が描画する HTML 出力の安全境界**
  であって、プラグイン本体のコードを縛る JS sandbox ではない (プラグインは
  普通の TypeScript としてサイトと同一の Node プロセス内で動く)
- **同期描画 surface 内でのネットワーク**。これらの surface は宣言的な
  出力を返す設計で、Promise を受け取らないし async result path も無い。
  `publicHead` の中で `await fetch(...)` を書くと SSR が無期限ブロックする
  (デッドラインを返す手段がない)。外向き HTTP が必要な処理は trusted
  Lambda (`hooks`) でやる
- **admin ルート / server ルート / コンテンツフィールドの追加** —
  Phase 6b 予約
- **Admin routes / server routes / content fields.** Phase 6b 予約。
  `settings.public` に credential を置かないこと

---

## 2. 最小ファイル構成

プラグインを作る最速の方法はスキャフォールドです:

```bash
# サイトローカル (現在の ampless サイトに plugins/<name>/index.ts を生成)
npx create-ampless@latest plugin my-thing

# スタンドアロン npm パッケージ (`npm publish` 向けの ./<name>/ を生成)
npx create-ampless@latest plugin @myscope/ampless-plugin-my-thing --standalone
```

全体の手順は §14 を参照してください。このセクションの残りでは生成されるファイルの意味を説明します — 手書きしたい場合はここを読めば把握できます。

### サイトローカル

```
plugins/
  my-thing/
    index.ts        # ファクトリ関数のみ。これがプラグインの全体
```

サイトの `package.json` / `tsconfig.json` がコンパイルを担うため、追加で ship するものはありません。`cms.config.ts` から相対 import で登録します。

### スタンドアロン npm パッケージ

```
ampless-plugin-my-thing/
  package.json
  tsconfig.json
  tsup.config.ts
  README.md
  CHANGELOG.md
  src/
    index.ts
    index.test.ts
```

本レポ内の `packages/plugin-rss/` と `packages/plugin-analytics-ga4/` が動作するファーストパーティの参考実装です — スタンドアロンスキャフォールドはこれらのレイアウトを踏襲します。

最小の `src/index.ts`:

```ts
import { definePlugin, type AmplessPlugin } from 'ampless'

export default function myPlugin(): AmplessPlugin {
  return definePlugin({
    name: 'my-plugin',
    apiVersion: 1,
    trust_level: 'untrusted',
    capabilities: ['publicHead'],
    publicHead() {
      return [{ type: 'meta', name: 'x-plugin', content: 'hi' }]
    },
  })
}
```

`cms.config.ts` に差し込み:

```ts
import myPlugin from 'my-plugin'

export default defineConfig({
  site: { name: 'My Blog', url: 'https://example.com' },
  plugins: [myPlugin()],
})
```

これで完了。`npm run dev` を再起動して任意のページのソースを表示すると `<meta name="x-plugin" content="hi" />` が `<head>` に出ています。

---

## 3. `AmplessPlugin` マニフェスト

```ts
interface AmplessPlugin {
  name: string                      // パッケージ風の識別子。例: 'analytics-ga4'
  packageName?: string              // インストール時のクロスチェック用 npm パッケージ名
  apiVersion: 1                     // 契約が変わるときだけ bump
  trust_level: 'untrusted' | 'trusted' | 'privileged'
  instanceId?: string               // 複数インストール時の namespace
  displayName?: LocalizedString     // admin UI ラベル
  capabilities?: readonly PluginCapability[]
  hooks?: { ... }                   // 非同期イベント
  metadata?(post, site): PluginMetadata
  siteMetadata?(site): PluginMetadata
  publicHead?(ctx): readonly PublicHeadDescriptor[]
  publicBodyEnd?(ctx): readonly PublicBodyDescriptor[]
  publicBodyForPost?(post: Post, ctx): readonly PublicPostBodyDescriptor[]
  publicHtmlForPost?(post: Post, ctx): readonly PublicPostHtmlDescriptor[]
  ogImage?: OgImageConfig
  settings?: { public?: readonly PluginSettingField[] }
}
```

### `name`

短い識別子 (`'analytics-ga4'`、`'rss'`、`'webhook'` など)。デフォルトの `instanceId` および trusted processor が S3 に書き出す `public/plugins/<name>/` のプレフィックスに使われます。`/^[a-zA-Z0-9_-]+$/` 必須 — 「命名規則」セクション参照。

### `apiVersion: 1`

今日は 1 のみ。将来の互換性破壊バージョンが出たらこの数字が bump され、runtime は未知の値を黙って bind せず拒否します。

### `instanceId`

optional、デフォルトは `name`。同じプラグインを 1 サイトで複数 instance 動かせる作り (例: 2 つの GA4 measurement ID、チャットプラットフォーム毎の webhook) では、ホストに `instanceId` を指定させて各々独立した namespace を持たせる:

```ts
analyticsGa4Plugin({ instanceId: 'marketing' })
analyticsGa4Plugin({ instanceId: 'product' })
```

`instanceId` も `name` も `/^[a-zA-Z0-9_-]+$/` を満たす必要があります。`.` は `pk='siteconfig', sk='plugins.<id>.<key>'` の区切りを壊します。scope (`@foo/bar`) やスラッシュは予約済みです。

### `displayName`

`/admin/plugins` のパネル見出し。単一ロケールのプラグインなら平文の文字列で十分。`{ en: 'GA4', ja: 'GA4' }` 形式の per-locale map にすると admin のアクティブロケールに応じて読み分けられます。

### `packageName`

省略可能。設定すると、runtime は起動時に `<packageName>/package.json` を解決し、そこにある静的な `amplessPlugin` ブロックをファクトリの戻り値とクロスチェックします。これにより、runtime で初めて気づく（あるいは永遠に気づかない）インストール時のミスを検出できます — capability の不一致はクラッシュせず、該当サーフェスが静かにスキップされるだけです。

スタンドアロンプラグインでは、`package.json#name` で宣言している npm パッケージ名をここに設定します:

```ts
return definePlugin({
  name: 'site-verification',
  packageName: '@ishinao/ampless-plugin-site-verification',
  apiVersion: 1,
  // ...
})
```

サイトローカルプラグインは不要です — 未設定のままにするとクロスチェックはスキップされます（Phase 5 より前のプラグインとの後方互換）。

### `package.json` の静的マニフェスト（スタンドアロンプラグインのみ）

クロスチェックが静的マニフェストを見つけるには、公開パッケージに 2 つの条件が必要です:

1. `package.json#amplessPlugin` がファクトリの戻り値と同じフィールドを宣言している:

   ```json
   "amplessPlugin": {
     "apiVersion": 1,
     "name": "site-verification",
     "trustLevel": "untrusted",
     "capabilities": ["publicHead", "adminSettings"],
     "displayName": { "en": "Site verification", "ja": "サイト所有権確認" }
   }
   ```

2. `package.json#exports` が `./package.json` を明示的に公開している:

   ```json
   "exports": {
     ".": {
       "import": "./dist/index.js",
       "types": "./dist/index.d.ts"
     },
     "./package.json": "./package.json"
   }
   ```

   これがないと、Node のパッケージエクスポートの制約により `import.meta.resolve('<pkg>/package.json')` が `ERR_PACKAGE_PATH_NOT_EXPORTED` で拒否され、runtime はクロスチェックを静かにスキップします（プラグインは動きますが、インストール時ガードは機能しません）。

`create-ampless plugin --standalone` スキャフォールドは両方を正しく生成します。また `package.json#keywords` に `"ampless-plugin"` を加えておくことをお勧めします — npm 検索で ampless プラグインを探す際の慣例です。

runtime がチェックする内容:

| フィールド | 不一致時の動作 |
|---|---|
| `apiVersion`（ファクトリ vs マニフェスト） | 起動時に **throws** |
| `apiVersion`（runtime がサポートするバージョンより新しい） | 起動時に **throws** |
| `name` | dev で warn |
| `trustLevel` | dev で warn |
| `capabilities`（集合比較） | dev で warn |

起動を中断するのは 2 つの `apiVersion` ケースのみです — これは runtime が対応していない ampless API でビルドされたプラグインのロードを防ぎます。その他はすべて開発者向けの警告であり、runtime のブロックではありません。

---

## 4. `trust_level` の選び方

3 階層、選択基準は **イベントフック (hooks) が何を必要とするか** で決まります (sync サーフェスは IAM に触れない):

| 階層 | IAM | 用途 |
|---|---|---|
| `untrusted` | なし (SQS consume のみ) | head/body descriptor、webhook 配送、コンテンツ変換 |
| `trusted` | 投稿読み出し、`public/plugins/<instanceId ?? name>/...` への書き込み | RSS フィード、sitemap、計算済み JSON インデックス |
| `privileged` | 予約 | 将来: SES、secret、private S3 |

決め方の目安:

- **`publicHead` / `publicBodyEnd` / `metadata` だけ必要** → `untrusted`
- **hooks から投稿を読みたい (publish 時にフィードを再生成等)** → `trusted`
- **`public/plugins/*` 以外への S3 PutObject や他の AWS API が必要** → 今はプラグインで ship せず、privileged 層を待つかプラグイン外で実装

trust level がズレているプラグインは「権限不足で sliently fail」または「不要に強い権限を持つ」のどちらか。階層を切り替えて再デプロイすれば直ります。

---

## 5. 同期サーフェス

**公開 Next.js プロセス** (サイト訪問者のリクエストスレッド) 内で同期実行
されます。これらの surface はネットワーク I/O を意図して設計していません。
async result path が無いので `publicHead` 内で `await fetch(...)` すると
SSR がデッドラインなしでブロックします。ネットワーク呼び出しが必要な副作用
は `hooks` (trusted Lambda、async) でやってください。公開プロセス内の
プラグインコードは公開ページ用の IAM ロールで動きます — 特別な AWS 権限は
ありません。

| サーフェス | 戻り値 | 用途 |
|---|---|---|
| `metadata(post, site)` | `PluginMetadata` (Next.js `Metadata` 形) | 投稿単位の `<title>` / OGP / Twitter / canonical |
| `siteMetadata(site)` | `PluginMetadata` | サイト全体の `<title>` / favicon / RSS `<link rel="alternate">` |
| `publicHead(ctx)` | `PublicHeadDescriptor[]` | 解析ローダー、フォント、jsonld、hreflang |
| `publicBodyEnd(ctx)` | `PublicBodyDescriptor[]` | GTM no-script フレーム、チャットウィジェット、末尾スニペット |
| `publicBodyForPost(post, ctx)` | `PublicPostBodyDescriptor[]` | 投稿単位の body 注入 — JSON-LD 構造化データ。テーマの post ページテンプレートが render する |
| `publicHtmlForPost(post, ctx)` | `PublicPostHtmlDescriptor[]` | 投稿単位の可視 HTML を `beforeContent` / `afterContent` に注入 — reading-time バッジ、breadcrumb、share リンク等。body は runtime が `sanitize-html` の厳格 allowlist で sanitize |

`ctx` オブジェクトの中身:

```ts
{
  site: Config['site']      // name / url / description
  setting<T>(key: string): T | undefined
}
```

`ctx.setting()` は Phase 2 で追加された admin 管理値アクセッサ — §8 参照。

---

## 6. Descriptor リファレンス

`publicHead` と `publicBodyEnd` は **descriptor オブジェクト** を返します。
`ReactNode` ではありません。runtime が validation (URL scheme denylist /
attrs allowlist / id dedup) してから React 要素を組み立てます。これは
プラグインが寄与できる **HTML 出力** の安全境界であって、プラグイン本体の
コード実行を縛るものではない、という点に注意 — プラグインは普通の
TypeScript としてサイトと同一の Node プロセスで動きます。descriptor
パイプラインは、JS sandbox に頼らずに公開ページの面を狭く / 監査可能に
保つための仕組みです。

### 共通の variant

```ts
// 外部 script
{
  type: 'script',
  id: 'ga4-loader-analytics-ga4',
  src: 'https://www.googletagmanager.com/gtag/js?id=G-XXX',
  strategy: 'afterInteractive', // または 'lazyOnload'
  async: true,                  // optional; strategy が暗黙的に付ける
  defer: false,
  attrs: { crossorigin: 'anonymous' },
}

// inline script — id は必須 (重複検知に使う)
{
  type: 'inlineScript',
  id: 'ga4-init-analytics-ga4',
  body: "/* 一行ブートストラップ */",
  strategy: 'afterInteractive',
}

// inline script — JSON-LD variant (publicHead / publicBodyEnd / publicBodyForPost で使用可能)
// runtime が body を自動 escape するので、生の JSON 文字列を返せばよい
{
  type: 'inlineScript',
  id: 'schema-article',
  scriptType: 'application/ld+json',
  body: JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', ... }),
}

// Meta / link / noscript
{ type: 'meta', name: 'theme-color', content: '#fff' }
{ type: 'meta', property: 'og:image', content: 'https://…' }
{ type: 'link', rel: 'preconnect', href: 'https://cdn.example.com' }
{ type: 'noscript', id: 'gtm-fallback-msg', html: '<p>JS required</p>' }
```

### body 専用の variant

```ts
// iframe — GTM の no-script フォールバック、チャットウィジェット等
{
  type: 'iframe',
  id: 'gtm-fallback',
  src: 'https://www.googletagmanager.com/ns.html?id=GTM-XYZ',
  height: 0,
  width: 0,
  attrs: { sandbox: 'allow-scripts' },
}
```

### `PublicPostBodyDescriptor`（Phase 4）

`publicBodyForPost` は `PublicPostBodyDescriptor[]` を返します。これは `inlineScript` の制限サブセットで、`scriptType` が必須かつ `'application/ld+json'` のみ有効です：

```ts
// publicBodyForPost で返せる唯一の形:
{
  type: 'inlineScript',
  id: 'schema-article',
  scriptType: 'application/ld+json',   // 必須 — これ以外は drop + warn
  body: JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', ... }),
}
```

`meta` / `link` を除いている理由：投稿単位のメタデータは Next.js `generateMetadata()` 経由の `metadata()` サーフェスが担い、フレームワークの deduplication・streaming と統合されている。`publicBodyForPost` は `generateMetadata` が生成できない構造化データ（`<script type="application/ld+json">`）のためだけに存在する。

### `PublicPostHtmlDescriptor`（Phase 6d）

`publicHtmlForPost` は `PublicPostHtmlDescriptor[]` を返します:

```ts
{
  type: 'html',
  id: 'display',                  // plugin-local 短識別子（≤ 64 文字、制御文字不可）
  position: 'beforeContent' | 'afterContent',
  body: '<p class="reading-time">約 3 分で読めます</p>',
}
```

runtime は `body` を `sanitize-html` の厳格 allowlist で sanitize し（詳しい allowlist と drop 対象は上の `publicHtmlForPost` 例を参照）、結果を `<div data-ampless-plugin="${namespace}" data-ampless-position="${position}">` で wrap します。テーマは `pages/post.tsx` で `{html.beforeContent}` / `{html.afterContent}` を embed するだけで、plugin の出力に対して `dangerouslySetInnerHTML` を書きません。

### JSON-LD 自動 escape

`scriptType === 'application/ld+json'` のとき、runtime は描画前に **`body` 文字列を自動 escape** する — `<` → `<`、`>` → `>`、`&` → `&`、U+2028 → ` `、U+2029 → ` `。この処理は `inlineScript` を受け付ける 3 つのサーフェス（`publicHead` / `publicBodyEnd` / `publicBodyForPost`）すべてで行われる。プラグイン作者は生の JSON 文字列を返せばよく、自前で escape しなくてよい。

サポート外の `scriptType` を持つ descriptor は **console warning 付きで drop** される。

### サーフェス別 scriptType ルール

| サーフェス | `scriptType` |
|---|---|
| `publicHead` | `undefined`（デフォルト JS）または `'application/ld+json'` |
| `publicBodyEnd` | `publicHead` と同じ |
| `publicBodyForPost` | `'application/ld+json'` **必須**。他の値（省略含む）は drop + warn |

### Validation ルール

- **URL scheme allowlist**: `http`、`https`、または相対パス。`javascript:`、`data:`、`vbscript:`、`blob:`、`file:` は要素描画前に拒否されます
- **`attrs` allowlist**: `data-*`、`crossorigin`、`referrerpolicy`、`integrity`、`fetchpriority`、`loading`、`sandbox`、`allow`、`allowfullscreen`。それ以外は dev warn 付きで drop
- **`inlineScript.id` は必須**。無いとプラグイン同士が似たスニペットを emit したときに dedup できず、dev warning も index 番号を指すだけで原因プラグインを特定できません
- **id 重複**: 最後の出現が勝ち。dev warning でどの key が重複したか表示されます
- **CSP nonce**: Phase 1 では伝搬しません。`nonce` attr は型上は宣言してありますが今のところ無視されます
- **strategy**: `afterInteractive` は外部 script に `async` を付ける。`lazyOnload` は `defer`。明示的な `async` / `defer` が常に勝ち。`beforeInteractive` は非対応

### runtime が描画する形

各プラグインについて runtime が `publicHead(ctx)` (resp. `publicBodyEnd`) を呼び、descriptor を validate して reject を drop、残ったものを `<Fragment>` でラップ。root layout はその Fragment を直接埋め込みます:

```tsx
<head>{pluginHead}</head>
{/* … */}
<body>… {pluginBodyEnd}</body>
```

`cms.config.plugins` の順序は集約後も保たれます。

### `publicBodyForPost` の使用例（Phase 4）

`schema` capability を宣言してサーフェスを実装します：

```typescript
import { definePlugin } from 'ampless'

export default function schemaJsonldPlugin() {
  return definePlugin({
    name: 'schema-jsonld',
    apiVersion: 1,
    trust_level: 'untrusted',
    capabilities: ['schema'],
    publicBodyForPost(post, ctx) {
      return [{
        type: 'inlineScript',
        id: 'schema-article',
        scriptType: 'application/ld+json',
        body: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: post.title,
          url: `${ctx.site.url}/${post.slug}`,
          datePublished: post.publishedAt,
        }),
      }]
    },
  })
}
```

テーマの `pages/post.tsx` が `ampless.publicBodyForPost(post)` を呼び、返された descriptor を描画します。runtime は自動 escape した body を持つ `<script type="application/ld+json">` 要素をページに挿入します。

### `publicHtmlForPost` 例（Phase 6d）

**可視 HTML** を post の周囲に出したいとき（reading-time バッジ、breadcrumb、share リンク、micro-format 注釈など）は `publicHtmlForPost` を使います。runtime が body を sanitize したうえで `beforeContent` / `afterContent` スロットに embed するので、テーマ側で `dangerouslySetInnerHTML` を書く必要はありません。

```typescript
import { definePlugin } from 'ampless'

export default function readingTimePlugin() {
  return definePlugin({
    name: 'reading-time',
    apiVersion: 1,
    trust_level: 'untrusted',
    capabilities: ['publicHtmlForPost'],
    publicHtmlForPost(post, _ctx) {
      const words = countWords(post)
      const minutes = Math.max(1, Math.round(words / 200))
      return [{
        type: 'html',
        id: 'display',
        position: 'beforeContent',
        body: `<p class="reading-time" data-words="${words}" data-minutes="${minutes}">約 ${minutes} 分で読めます</p>`,
      }]
    },
  })
}
```

テーマの `pages/post.tsx` は `const html = await ampless.publicHtmlForPost(post)` を 1 回呼び、スロットを embed します:

```tsx
{postBody}            {/* publicBodyForPost — JSON-LD */}
{html.beforeContent}  {/* publicHtmlForPost — beforeContent スロット */}
<div className="prose" dangerouslySetInnerHTML={{ __html: renderBody(post) }} />
{html.afterContent}   {/* publicHtmlForPost — afterContent スロット */}
```

**スロット位置**（v1）: `'beforeContent'` / `'afterContent'` の 2 つ。

**Sanitizer（厳格、trust level に関わらず同一）:**

- 許可タグ: `p` · `span` · `strong` · `em` · `a` · `code` · `br` · `ul` · `ol` · `li`
- 許可グローバル属性: `class` · `data-words` · `data-minutes` · `data-ampless-*`
- 許可 `<a>` 属性: `href` · `rel` · `target`。`target="_blank"` のとき sanitizer が `rel="noopener noreferrer"` を自動付与
- `href` で許可するスキーム: `http` / `https`。相対 URL (`./path` / `../path` / `/path` / `#anchor`) は素通り。`javascript:` / `data:` / `mailto:` / `tel:` / `vbscript:` は drop
- drop されるタグ・属性: `<img>` · `<iframe>` · `<video>` · `<audio>` · `<object>` · `<embed>` · `<form>` · `<style>` · インライン `style` · 全 event handler (`on*`)

allowlist 外のタグが必要になった場合は issue を立ててください。allowlist は設計上拡張するものであって、escape hatch ではありません。

**`id` は plugin-local。** 短い識別子（例: `'display'`）を使います。runtime が React `key` および wrapper `<div>` の `data-ampless-plugin` / `data-ampless-position` 属性を組むときに `${instanceId ?? name}:${id}` で resolve するので、plugin 作者が自前で namespace を埋め込む必要はありません。validator は `id` が空、制御文字を含む、64 文字超のいずれかなら descriptor を drop します。

**dedupe は position ごと。** 1 つの plugin instance が `beforeContent` と `afterContent` の両方に同じ `id` を返すのは OK（dedupe スコープが独立）。同じ position に同じ `id` を 2 回返すと最初の 1 件を残して 2 件目を warn 付きで drop します。

**複数 instance。** distinct な `instanceId` を持つ 2 つの `reading-time` instance（例: `reading-time-en` / `reading-time-jp`）は、同じ position に `id: 'display'` を返しても両方残ります（namespace が違うため）。

### クライアントサイドの DOM 操作はしない

`publicHead` または `publicBodyEnd` から返したインラインスクリプトは、React がページを hydrate する前、HTML のパース中に実行されます。**React が管理するサブツリー内の見える DOM を操作してはいけません** — hydration が走ると React は仮想 DOM と合わないツリーを検出し、`Hydration failed because the server rendered HTML didn't match the client` エラーを投げてサブツリーをゼロから再生成します。挿入したノードは消えてしまいます。

React 19 はさらに、クライアントコンポーネントのレンダー中に出会った `<script>` タグの実行を拒否するため、`document.body.append(myNewElement)` のようなスクリプトはそもそも発火しないことがあります。

**安全なパターン**:

- **グローバル状態 / 非 DOM の副作用**: `window.dataLayer` への push、設定オブジェクトのセット、アナリティクス SDK のインスタンス化。`@ampless/plugin-analytics-ga4`・`@ampless/plugin-gtm`・`@ampless/plugin-plausible` はこの方法を使っています。
- **外部ウィジェットローダー**: 自前の独立したコンテナを管理するサードパーティスクリプトの読み込み（Crisp・Intercom・Drift など）。ウィジェットの shadow DOM / fixed-position オーバーレイは React のツリーの外にあり、hydration と競合しません。
- **SSR 専用の descriptor**: `meta` / `link` / `noscript`（`publicBodyEnd` では `iframe` も）を返す — runtime がサーバーサイドで描画するため、最初から React の仮想 DOM の一部になります。

**避けるべきパターン**:

- `document.createElement('div')` + `document.body.append(...)`
- テーマが描画した要素のクラス / 属性 / テキストコンテンツの変更
- クライアントサイドで `#post-body` のような要素を読み取って投稿単位の HTML を挿入する — 現在 `publicHead`-for-post に相当するサーフェスはなく、サーバーレンダリング済みのサブツリーをクライアントサイドで書き換えると hydration と競合します

投稿単位の見える出力には `publicHtmlForPost` を使ってください（Phase 6d — 上の例と §6 の `PublicPostHtmlDescriptor` 参照）。runtime が post 本文の周囲の固定スロットにサーバーサイド HTML を出すので、hydration と競合しません。

---

## 7. 非同期イベントフック

`hooks` は SQS から到着したイベントを trust_level に対応する processor Lambda が受けて実行します。runtime context (`ctx`) の中身:

```ts
interface PluginRuntimeContext {
  site: Config['site']
  listPublishedPosts(): Promise<Post[]>   // trusted のみ
  writePublicAsset(key: string, body, contentType): Promise<string>  // trusted のみ
}
```

例: RSS プラグイン ([`packages/plugin-rss/src/index.ts`](https://github.com/heavymoons/ampless/blob/main/packages/plugin-rss/src/index.ts) 参照):

```ts
hooks: {
  'content.published': async (_event, ctx) => {
    const posts = await ctx.listPublishedPosts()
    const xml = buildRssFeed(posts, ctx.site)
    await ctx.writePublicAsset('feed.xml', xml, 'application/rss+xml')
  },
  'content.unpublished': /* 同じ */,
  'content.deleted': /* 同じ */,
  'content.updated': /* 同じ */,
}
```

### `writePublicAsset`

公開生成ファイルを書き出す trusted plugin は capability を宣言してください:

```ts
capabilities: ['eventHooks', 'writePublicAsset']
```

同じ plugin が `metadata()` または `siteMetadata()` も実装する場合は、`metadata` も宣言します。この capability 名は両方の metadata 関数をまとめて表し、別個の `siteMetadata` capability はありません。

trusted processor は次の場所に書き込みます:

```txt
public/plugins/<instanceId ?? name>/<key>
```

`key` は allowlist `[A-Za-z0-9._/-]+` に一致する必要があります。それ以外（スペース、URL 予約文字 `#` `?` `&` `=` `+`、非 ASCII 文字 (`日本語.xml` 等)、空文字、絶対パス（`/` 始まり）、`.` / `..` path segment、backslash、制御文字、256 文字超）は S3 呼び出し前に拒否されます。`indexes/posts.json` のような nested path や `feed.v2.xml` のような複数 dot は許可されます。allowlist を厳しく絞っているのは、返却 URL と実 S3 key を byte 等しい文字列に保つため — URL 予約文字は S3 では生バイトとして通るが、URL を consumer が parse すると別 object を指す状態になる。user 由来の文字を key に入れたい場合は事前に sanitize (hash、slugify 等) してから `ctx.writePublicAsset()` を呼んでください。戻り値は書き込まれた object の public URL です。

移行期間中、`capabilities` フィールドが無い plugin はそのまま動きます。`capabilities` を宣言しているのに `writePublicAsset` を省いた plugin は、実際に `ctx.writePublicAsset()` を呼んだ時に 1 回だけ warn します。

### ベストプラクティス

- **冪等にする**。SQS は at-least-once 配送 — 同じイベントが 2 回 fire する可能性があります。同じ入力で同じ出力 (決定論的なフィード等) を生成するようにしてください
- **宣言していない `event.payload.*` を読まない**。形は [`docs/architecture/05-event-system.md`](https://github.com/heavymoons/ampless/blob/main/docs/architecture/05-event-system.md) に文書化されています。形がドリフトすると暗黙の読み出しが silent に壊れます
- **エラーは DLQ に行く**。フック内で throw すると最終的にメッセージは dead-letter queue に届きます。失敗のサーフェスは通常の CloudWatch ダッシュボードで

---

## 8. `settings.public` — admin 管理の値 (Phase 2)

`settings.public` マニフェストを宣言すると、ホストには `/admin/plugins` の編集 UI が自動で生えます。

```ts
settings: {
  public: [
    {
      type: 'text',
      key: 'measurementId',
      label: { en: 'Measurement ID', ja: '測定 ID' },
      description: { en: 'GA4 ID, blank to disable', ja: '空で無効化' },
      pattern: '^$|^G-[A-Z0-9]+$',
      placeholder: 'G-XXXXXXXX',
      default: 'G-XXXXXXXX',
    },
  ],
}
```

### 利用可能な field タイプ

| Type | 保存形 | 補足 |
|---|---|---|
| `text` | string | `pattern`、`maxLength`、`placeholder` |
| `textarea` | string | `rows`、`maxLength` |
| `url` | string | save 時に scheme チェック、`allowRelative` |
| `code` | string | `language` ラベル (表示用)、Phase 2.5 で専用エディタに差し替え予定 |
| `boolean` | boolean | チェックボックスで描画 |
| `number` | number | `min` / `max` / `step` |
| `select` | string (`options[i].value` のいずれかと一致必須) | `options` 必須 |
| `json` | decoded value (object / array / number / boolean) | admin form は save 前に `JSON.parse` |

### 保存形

保存される値は DynamoDB の以下に landing:

```
pk = 'siteconfig'
sk = 'plugins.<instanceId>.<fieldKey>'
```

trusted processor がこの行を S3 の `public/site-settings.json` にミラー。`publicHead` / `publicBodyEnd` 実行時に公開 runtime がこの file を fetch (60s `revalidate`、`site-settings` cache tag) し、描画パス内から同期読み出しできるようになります。

### required / 無効化 / 未設定 の違い

- `required: true` は save 時に empty / undefined を reject、admin form にエラー表示
- **string 系 field** (`text` / `textarea` / `url` / `code`) は、`required` が falsy のとき **空文字保存が valid**。これが「無効化」シグナル — 例えば GA4 では `measurementId` を空文字保存することで、プラグインを削除せず解析を停止できます
- **非 string 系 field** (`number` / `boolean` / `json` / `select`) は常に空文字 reject。保存値をクリアしたい場合はユーザが **デフォルトに戻す** を押す — DDB 行が削除され、次のリクエストから `manifest.default` にフォールバックします

---

## 9. 設定値の読み出し: `ctx.setting<T>(key)`

`publicHead` / `publicBodyEnd` 内で解決済みの値を読み出すには `ctx.setting`:

```ts
publicHead(ctx) {
  const id = ctx.setting<string>('measurementId') ?? ''
  if (!id) return []
  return [/* id を使った descriptor */]
}
```

リクエスト毎の解決順序:

```
stored 値 (validated)
  ↳ manifest.default (これも validated)
    ↳ undefined
```

両側で validation を通すので、手で DDB 行を編集した結果 out-of-range になった値 (あるいは constructor 引数として渡された壊れた default) がページに漏れません。renderer は invalid 値を「存在しない」かのように扱い、次の valid 層が引き継ぎます。

スナップショットがいつ更新されるか: trusted processor が `public/site-settings.json` の再生成を完了した後、次の Next.js fetch cache TTL (60s) を過ぎたリクエストから新値を読みます。admin form は cache invalidation を ~8s 遅延発火するので、processor の S3 rebuild が完了する前に公開側が古い JSON を fetch して詰めてしまう race を避けています。

### 複数インスタンス

各プラグインインスタンスは `instanceId` でスコープされた独立 namespace を持ちます。`cms.config.ts` 内の 2 回の `analyticsGa4Plugin({ instanceId: 'a' })` と `analyticsGa4Plugin({ instanceId: 'b' })` は別々の DDB 行を見ます。`ctx.setting()` は自プラグインの `instanceId` に自動スコープします。

---

## 9a. Secret settings: `ctx.secret<T>(key)` (Phase 6a)

Secret settings を使うと、trusted プラグインが認証情報 (Webhook 署名 secret・SMTP パスワード・外部 API トークン等) を admin UI 経由で保存・ローテーションできます。**公開サイトやブラウザ側コードに値が流れることはありません**。

### なぜ `settings.public` と API が違うのか

`settings.public` の値は公開 runtime に流れる設計です。`public/site-settings.json` にミラーされ、`ctx.setting()` で sync render surface から読めます。analytics の measurementId などには適切ですが、Webhook 署名 secret には絶対に使えません。

`settings.secret` はストレージモデルが構造的に異なります:

- KvStore とは **別テーブル** の `PluginSecret` DynamoDB model に保存。
- 値は保存前に **AES-256-GCM 暗号化**される — 平文が DynamoDB に保存されることはない。admin/editor グループは AppSync 経由で `value` 列を読めるが、読めるのは暗号化済みブロブのみ。暗号化はブラウザ側で `crypto.subtle` を使ってから AppSync 呼び出しが行われる。
- 防衛層多重化: AppSync/Cognito がアクセスを制御し、AES-256-GCM が DynamoDB を直接参照できる者（AWS Console 等）からの平文漏洩を防ぐ。
- trusted-processor Lambda が `node:crypto` で復号する。`ctx.secret<T>(key)` は平文 string を返す（ciphertext ではない）。
- S3 mirror 経路に絶対に流れない（mirror は KvStore のみを query する）。
- 公開 render surface (`publicHead` など) からは読めない。

### 要件

`settings.secret` には 2 つの要件があります:

1. `trust_level: 'trusted'` — untrusted Lambda には PluginSecret table への DDB read 権限がない。他の trust level で宣言すると `definePlugin()` 時に throw する。
2. `'secretSettings'` を `capabilities` に含める — admin UI や将来の allow-list から capability を参照できるようにするため必須。省略すると console.warn（`'schema'` vs `publicBodyForPost` の不整合パターンと同じ）。

### secret フィールドの宣言

```ts
import { definePlugin } from 'ampless'

export default function webhookPlugin(opts?: { signingSecret?: string }) {
  // constructor から渡された secret は closure-private な fallback として保持。
  // manifest にも descriptor にも出さない。
  const constructorSecret = opts?.signingSecret

  return definePlugin({
    name: 'webhook',
    apiVersion: 1,
    trust_level: 'trusted',
    capabilities: ['eventHooks', 'secretSettings'],
    settings: {
      secret: [
        {
          type: 'text',
          key: 'signingSecret',
          label: { en: 'Webhook signing secret', ja: 'Webhook 署名 secret' },
          maxLength: 256,
          required: false,
          // `default` は型レベルで除外されている。closure-private fallback を使うこと。
        },
      ],
    },
    hooks: {
      async 'content.published'(event, ctx) {
        // ctx.secret() は PluginSecret DDB table から読む。
        // admin が未保存なら undefined を返す。
        const storedSecret = await ctx.secret<string>('signingSecret')

        // closure-private fallback: admin が未保存の場合 constructor 引数を使う。
        // これで既存サイトとの後方互換を維持できる。
        const secret = storedSecret ?? constructorSecret
        if (!secret) return

        // ... secret で署名して POST
      },
    },
  })
}
```

### 重要: secret フィールドに `default` を書かない

`PluginSecretField` 型は `Omit<PluginTextField, 'default'> | Omit<PluginTextareaField, 'default'>` として定義されており、**`default` プロパティは型レベルで除去**されています。追加しようとすると TypeScript がエラーを出します。

理由: `default` は admin UI のフォーム props (ブラウザに送出される)、静的 manifest の cross-check、JS bundle など複数の経路で漏洩します。認証情報に使えない設計です。

fallback 値がある場合は、プラグイン factory 関数の closure-private 変数として保持してください:

```ts
// ✓ 正解 — closure-private、manifest に出さない
const constructorSecret = opts?.signingSecret

// ✗ 誤り — TypeScript エラー、さらに browser にも漏れる
settings: {
  secret: [{
    type: 'text',
    key: 'signingSecret',
    label: 'Secret',
    default: opts?.signingSecret, // ← TS compile error
  }],
}
```

### secret の読み出し: `ctx.secret<T>(key)`

`ctx.secret<T>(key)` は trusted hook handler 内でのみ利用できます (`processor-trusted.ts` が注入)。シグネチャ:

```ts
ctx.secret<T = string>(key: string): Promise<T | undefined>
```

- admin が未保存なら `undefined` を返す。
- `T` は convenience cast (ctx.setting と同じ)。値は常に string として保存される。
- 結果は per-invocation キャッシュされる。同 batch 内で同キーを 2 回呼んでも DDB 呼び出しと復号処理は 1 回ずつ。暗号化キー自体は Lambda コンテナ lifetime でキャッシュされ、cold start 以降は再 fetch しない。
- キャッシュされる値は **復号済みの平文** — ciphertext ではない。2 回目の呼び出しで再復号は発生しない。
- cache key は namespace 化される: `${instanceId ?? name}:${fieldKey}`。異なる plugin instance が同名フィールドを持っても混線しない。

### admin UI

`settings.secret` を宣言すると、admin plugin settings ページの public フィールドの下に **Secret settings** セクションが表示されます。各フィールド:

- **未保存**: 通常テキスト入力 + Save ボタン。
- **保存済み**: マスク表示 `••••••••` + Replace + Clear ボタン。値は絶対に取得・表示されない。
- **編集中**: Replace クリック後 — 新値入力 + Save + Cancel。

admin は再デプロイなしにいつでも secret をローテーションできます。保存後 ~5〜10 秒以内に次の trusted Lambda 実行から新値が使われます。

---

## 10. ウォークスルー: GA4 を Phase 1 から Phase 2 に移行する

Phase 1 の GA4 プラグインは measurement ID を constructor 引数で受けていました。Phase 2 では後方互換のためにその引数を残しつつ、値は `ctx.setting()` 経由で読みます。

**Before** (Phase 1):

```ts
export default function analyticsGa4Plugin(opts: { measurementId: string }) {
  const { measurementId } = opts
  return definePlugin({
    name: 'analytics-ga4',
    apiVersion: 1,
    trust_level: 'untrusted',
    capabilities: ['publicHead'],
    publicHead() {
      if (!measurementId) return []
      return [/* measurementId を使う descriptor */]
    },
  })
}
```

**After** (Phase 2):

```ts
export default function analyticsGa4Plugin(opts: { measurementId?: string } = {}) {
  const { measurementId = '', instanceId = 'analytics-ga4' } = opts
  return definePlugin({
    name: 'analytics-ga4',
    instanceId,
    apiVersion: 1,
    trust_level: 'untrusted',
    capabilities: ['publicHead', 'adminSettings'],
    settings: {
      public: [{
        type: 'text',
        key: 'measurementId',
        label: { en: 'Measurement ID', ja: '測定 ID' },
        pattern: '^$|^G-[A-Z0-9]+$',
        default: measurementId,
      }],
    },
    publicHead(ctx) {
      const id = ctx.setting<string>('measurementId') ?? ''
      if (!id) return []
      return [/* id を使う descriptor */]
    },
  })
}
```

constructor 引数は `manifest.default` の seed になります。`cms.config.ts` で既に `analyticsGa4Plugin({ measurementId: 'G-X' })` を渡している運用者は挙動変化なし。新規デプロイは空にして admin UI 側で設定する運用が推奨です。

---

## 11. テスト

ampless は vitest を使っています。典型的なプラグインテストはこんな形:

```ts
import { describe, it, expect } from 'vitest'
import type { PluginPublicRenderContext, AmplessPlugin } from 'ampless'
import { resolvePluginSettings } from 'ampless'
import myPlugin from './index.js'

function makeCtx(plugin: AmplessPlugin, stored: Record<string, unknown> = {}): PluginPublicRenderContext {
  const resolved = resolvePluginSettings(plugin.settings, stored)
  return {
    site: { name: 'Test', url: 'https://example.com/' },
    setting: (k) => resolved[k],
  }
}

it('measurementId 設定時に descriptor を吐く', () => {
  const plugin = myPlugin({ measurementId: 'G-XXX' })
  const descriptors = plugin.publicHead?.(makeCtx(plugin)) ?? []
  expect(descriptors).toHaveLength(2)
})

it('admin が空文字保存した場合は空配列', () => {
  const plugin = myPlugin({ measurementId: 'G-XXX' })
  const descriptors = plugin.publicHead?.(makeCtx(plugin, { measurementId: '' })) ?? []
  expect(descriptors).toEqual([])
})
```

マニフェスト + 描画挙動をテストすればよいです。runtime の descriptor validator は `@ampless/runtime` 側でテストされているので、プラグインテストは「何の状態でどの descriptor を返すか」に集中してください。

イベントフックのテストは `ctx.listPublishedPosts` と `ctx.writePublicAsset` を単純なスタブ関数で差し替えます。

---

## 12. npm publish

ファーストパーティ / モノレポ内部のプラグインは本レポの既存 changeset フローに従ってください。外部プラグインは通常の npm パッケージ:

- **パッケージ名**: `@your-scope/plugin-foo`。`@ampless/plugin-*` スコープは本モノレポから ship する公式プラグイン用に予約
- **エントリ**: ESM のみ、default export (factory) + 設定インターフェイス (ユーザの `cms.config.ts` から型付きで引数を渡せるように) を export
- **`apiVersion`**: 契約が変わるときだけ bump。既存フィールドの型が変わったら major、新フィールド追加なら minor (既存インストールは動き続ける)
- **Dist-tag**: ampless 自体が alpha のうちは `@alpha`。`@latest` は ampless v1.0 まで予約

参考実装:

- [`packages/plugin-analytics-ga4`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-analytics-ga4) — descriptor ベース、Phase 2 settings
- [`packages/plugin-gtm`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-gtm) — `publicHead`（ローダーインラインスクリプト）+ `publicBodyEnd`（`<noscript>` iframe フォールバック）を両方使用、コンテナ ID は admin 編集可能
- [`packages/plugin-plausible`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-plausible) — `data-*` attrs 付きの単一 `<script>` descriptor、`required` な URL field（self-hosted Plausible 上書き対応）
- [`packages/plugin-rss`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-rss) — trusted、非同期 hooks + `writePublicAsset`
- [`packages/plugin-seo`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-seo) — `metadata()` + `siteMetadata()`
- [`packages/plugin-webhook`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-webhook) — untrusted hook + 外向き HTTP
- [`packages/plugin-og-image`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-og-image) — `ogImage` ルートレンダラ
- [`packages/plugin-schema-jsonld`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-schema-jsonld) — `publicBodyForPost` + `schema` capability、投稿単位 Article JSON-LD。（Phase 4）

---

## 13. 命名規則とよくある落とし穴

### 命名規則

- `name`、`instanceId`、`settings.public.key` のすべて: `/^[a-zA-Z0-9_-]+$/` 必須。違反した plugin / field は dev console warning 付きで runtime が drop します
- `plugins.<instanceId>.<fieldKey>` のドット区切りが保存形式の唯一の構造です。key 側にネストしたドットを入れて凝らないでください

### よくある落とし穴

- **capability と実装の不一致**。`capabilities: ['publicHead']` を宣言したのに `publicHead` を未定義 (またはその逆) にすると、起動時に console warning が出ます。capability を外すか関数を追加してください
- **`instanceId` 重複**。同じ namespace を共有する 2 つのインスタンスは起動時に警告が出ます。後者の保存設定は前者と衝突します
- **`inlineScript` の `id` 忘れ**。production では silent に drop、dev では warn。inline script の dedup は id 無しではできません
- **`publicHead` から `ReactNode` を返す**。TypeScript で弾かれます — `publicHead` の戻り値型は descriptor のみ。任意 `ReactNode` が必要なら、それは Phase 6b の `developer.headElements` capability 待ち
- **admin form から `manifest.default` を保存してしまう**。resolved default を「明示値」として書き戻さないでください — admin form が touched フィールドのみ書き込む設計はまさにこのため。default 値を保存すると future のパッケージ更新で default が変わってもそのフィールドだけ反映されなくなります
- **`publicBodyForPost` で `scriptType: 'application/ld+json'` を省略**。`publicBodyForPost` が返す descriptor で `scriptType` を省略するか他の値を指定すると、production では silent に drop、dev では warn されます。このサーフェスで有効なのは `'application/ld+json'` だけです
- **`schema` capability と `publicBodyForPost` の不一致**。`capabilities: ['schema']` を宣言して `publicBodyForPost` を未実装（またはその逆）にすると起動時に warning が出ます。宣言と実装は同期させてください

---

## 14. クイックスタート: `create-ampless` でスキャフォールド

アイデアから動くプラグインへの最速ルートとして、`create-ampless` CLI には `plugin <name>` サブコマンドが用意されています:

```bash
# サイトローカル: 現在の ampless サイトのルートで実行
# plugins/<name>/index.ts を生成する
npx create-ampless@latest plugin my-thing \
  --trust-level untrusted \
  --capabilities publicHead,adminSettings

# スタンドアロン npm パッケージ: ./<dir>/ を生成
# package.json / tsconfig.json / tsup.config.ts / README + .ja /
# CHANGELOG / .gitignore / src/index.ts + src/index.test.ts を含む
# 新しいパッケージディレクトリを置きたい場所で実行する
npx create-ampless@latest plugin @myscope/ampless-plugin-thing \
  --standalone \
  --trust-level untrusted \
  --capabilities publicHead,adminSettings \
  --description "このプラグインが何をするか"
```

スタンドアロンスキャフォールドには Phase 5 のクロスチェックに必要なものがすべて含まれます: `package.json#amplessPlugin`、`./package.json` サブパスエクスポート、`packageName` ファクトリフィールド、`ampless-plugin` 検索キーワード、そして `pnpm install && pnpm test && pnpm build` が生成直後にクリーンに通る最小の vitest サンプル。

どちらのモードも、フラグなしの位置引数呼び出し (`npx create-ampless@latest plugin`) で @clack のプロンプト UI を使ったインタラクティブモードに切り替えられます。

### スタンドアロンプラグインの公開

```bash
cd ampless-plugin-thing
pnpm install
pnpm test
pnpm build
pnpm publish --access public --tag alpha
```

スコープ付き名前 (`@scope/...`) には `--access public` が必須です。`--tag alpha` は現在の ampless プレリリースサイクルに合わせています — 安定 major に達したら外してください。

`npm publish` が返った直後に `npm install <pkg>@alpha` で 404 が出ることがあります（CDN とレジストリレプリカの伝播遅延）。その場合は 1〜2 分待ってリトライしてください — `npm view <pkg>@alpha version` がレジストリで見えていることは必要条件ですが十分条件ではありません。

### パッケージの命名

npm の慣例として、スコープと `ampless-plugin-` プレフィックスを除いた短い識別子が `AmplessPlugin.name` になります:

| npm パッケージ | `AmplessPlugin.name` |
|---|---|
| `@ampless/plugin-gtm` | `gtm` |
| `@scope/ampless-plugin-clarity` | `clarity` |
| `ampless-plugin-readme-toc` | `readme-toc` |
| `weird-name-no-prefix` | `weird-name-no-prefix` |

スキャフォールドはこのストリッピングを自動で行います。スキャフォールドを使わない場合も同じマッピングで手書きしてください。パッケージの静的マニフェストとファクトリで `name` が一致しない場合はインストール時クロスチェックが警告します。

### サイトローカルの後作業

サイトローカルのスキャフォールド後:

```ts
// cms.config.ts
import myThingPlugin from './plugins/my-thing'

export default defineConfig({
  // ...
  plugins: [
    myThingPlugin(),
  ],
})
```

スキャフォールドの最後にこのスニペットが表示されます — `cms.config.ts` にコピーしてプラグインを有効化してください。

`update-ampless` は `plugins/` ディレクトリを決して変更しません（PROTECTED 扱い）。ampless のアップグレードをまたいでも安全に残ります。

---

## 15. 質問先

- アーキテクチャ / 設計の質問 → [`docs/architecture/08-plugin-architecture.ja.md`](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.ja.md)
- ファーストパーティプラグインの bug → `heavymoons/ampless` にプラグインの package 名つきで issue
- プラグインランタイム / admin form の bug → 同じレポ、ラベル `area:plugins`

ampless レポは v1.0 RC まで非公開なので、上記のリンクは現時点では package tarball 内の `node_modules/ampless/docs/` をローカルで見るための参照です。public 化後は実 GitHub URL に解決されます。
