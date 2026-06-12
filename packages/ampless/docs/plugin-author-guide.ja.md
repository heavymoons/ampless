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

> **ポジショニング**: ampless はエンジニア向けのカスタマイズベース CMS です — プラグインは**サイトエンジニアが `cms.config.ts` でインポート + 設定する npm dep** です。エンジニアは他の npm ライブラリと同様にインストール前に各 dep を審査します（Astro integration / Next.js plugin パターン）。このガイドで説明する trust framework（`trust_level`、capabilities、IAM スコープ付き Lambda）は v1 において**ファーストパーティプラグインの code organization**として実装されています — どの trust 階層の Lambda が各イベントフックを実行するか、各階層が保有する IAM 権限、そして狭い範囲のポイントでのみ runtime hard gate を適用する（最も重要: `settings.secret` は `trust_level: 'trusted'` を要求、シークレット読み取りに trusted Lambda の IAM 権限が必要なため）。ほとんどの capability 宣言は runtime の hard gate ではなく soft warning + admin ラベル + 将来の allow-list surface です。任意の未審査サードパーティ untrusted プラグインを自動的に安全に動かすための marketplace-grade automatic sandbox としては**設計されていません**。マーケットプレイス + ランタイムサンドボックスは v2.0+ の探索であり、v1 の保証ではありません。詳細な trust model は [`docs/architecture/08-plugin-architecture.md#trust-model-v1-scope`](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.md#trust-model-v1-scope) を参照してください。

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

§14 には一行のスキャフォールドコマンド (`npx create-ampless@beta plugin <name>`) があり、後者 2 つのどちらにも即使えるボイラープレートを生成します。

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
npx create-ampless@beta plugin my-thing

# スタンドアロン npm パッケージ (`npm publish` 向けの ./<name>/ を生成)
npx create-ampless@beta plugin @myscope/ampless-plugin-my-thing --standalone
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
  apiVersion: 1                     // 現状唯一の有効値
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
  settings?: {
    public?: readonly PluginSettingField[]
    secret?: readonly PluginSecretField[]
    version?: number  // Phase 1 reservation; runtime ignores
  }
}
```

### `name`

短い識別子 (`'analytics-ga4'`、`'rss'`、`'webhook'` など)。デフォルトの `instanceId` および trusted processor が S3 に書き出す `public/plugins/<name>/` のプレフィックスに使われます。`/^[a-zA-Z0-9_-]+$/` 必須 — 「命名規則」セクション参照。

### `apiVersion: 1`

今日は 1 のみ。将来の互換性破壊バージョンが出たらこの数字が bump され、runtime は未知の値を黙って bind せず拒否します。

**現状唯一の有効値は `apiVersion: 1` です。** literal type は他の値を compile-time に拒否し、`package.json#amplessPlugin.apiVersion` が `definePlugin()` の戻り値と異なる場合、または runtime の `SUPPORTED_API_VERSION` を超える場合、runtime は hard-throw します。

Phase 1 の compat-break reservation すべて（PR #220、#222、#230、#232、#234）は `apiVersion: 1` 内に収まります。これらをプラグインで declare するかどうかは契約バージョンに影響しません。

将来 `apiVersion: 2` が導入される場合は、changeset とこのガイドおよび architecture doc のセクション更新を通じてアナウンスされます。それまでは、**`apiVersion: 1` でプラグインを publish し、唯一の有効値として扱ってください**。v2 bump の trigger となるもの（ならないもの）の全基準については、architecture doc の [apiVersion bump policy](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.md#apiversion-bump-policy) セクションを参照してください。

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

trust 階層は v1 において**ファーストパーティプラグインの code organization**として実装されています — イベントフックがどの IAM スコープ付き Lambda で実行されるか、その Lambda が保有する権限を決定します。これはエンジニアが審査した npm dep 向けの code organization surface であり、任意のサードパーティ未審査プラグインを自動的に安全に動かすための marketplace-grade automatic sandbox ではありません（上記の[ポジショニング注記](#ampless-プラグインの書き方)と[詳細な trust model](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.md#trust-model-v1-scope) を参照）。

3 階層、選択基準は **イベントフック (hooks) が何を必要とするか** で決まります (sync サーフェスは IAM に触れない):

| 階層 | IAM | 今日動くもの | 用途 |
|---|---|---|---|
| `untrusted` | なし (SQS consume のみ) | 同期サーフェス + イベントフック | head/body descriptor、webhook 配送、コンテンツ変換 |
| `trusted` | 投稿読み出し、`public/plugins/<instanceId ?? name>/...` への書き込み | 同期サーフェス + イベントフック | RSS フィード、sitemap、計算済み JSON インデックス |
| `privileged` | 予約（v2.0+ 探索のみ） | 同期サーフェスのみ — イベントフックはサイレントフィルタ（警告ログあり） | 将来のマーケットプレイス探索: SES、secret、private S3 |

> **`privileged` プラグイン作者へ：** `trust_level: 'privileged'` とイベント
> `hooks` を宣言した場合、**現時点でフックは実行されません**。両 processor が
> privileged プラグインをフィルタアウトし、一致する SQS イベントごとに
> `console.warn` を出力するため、サイレントドロップは可視化されます。
> 同期サーフェス（`publicHead`、`publicBodyEnd`、`metadata`、`publicBodyForPost`、
> `publicHtmlForPost`）は `trust_level` に関わらず正常に動き、警告も出ません。
> privileged Lambda プロビジョニングは v2.0+ の探索項目です — ampless が
> プラグインマーケットプレイスを構築する場合、すでに `'privileged'` を宣言した
> プラグインは自動的に新しい tier を使えるようになります。
> v1 ファーストパーティプラグインは trusted Lambda の現行 IAM スコープに収まる用途で `trust_level: 'trusted'` を使ってください。すなわち Post / KvStore / PluginSecret / PostTag の読み取り、`public/plugins/*` への S3 書き込み、外向き HTTP (AWS IAM 認証を必要としないもの) です。このスコープ外の要件 — SES、private S3 プレフィックス、自前の IAM プリンシパルを必要とする AWS API 呼び出し — は v2.0+ privileged Lambda 探索の対象で、v1 `trusted` には収まりません。

決め方の目安:

- **`publicHead` / `publicBodyEnd` / `metadata` だけ必要** → `untrusted`
- **hooks から投稿を読みたい (publish 時にフィードを再生成等)** → `trusted`
- **`public/plugins/*` 以外への S3 PutObject や他の AWS API が必要** → 今はプラグインで ship せず、privileged 層を待つかプラグイン外で実装

trust level がズレているプラグインは「権限不足でサイレントに fail」または「不要に強い権限を持つ」のどちらか。階層を切り替えて再デプロイすれば直ります。

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
- **CSP nonce**: `inlineScript.nonce` と `script.nonce` は型として受け入れられます（`'auto'` は将来の runtime スタンプ用 sentinel。文字列リテラルも可）。Phase 1 予約: runtime はフィールドを受け入れますが描画要素には伝搬しません。詳細は下記の [CSP nonce（Phase 1 予約）](#csp-nonce-phase-1-) を参照。
- **strategy**: `afterInteractive` は外部 script に `async` を付ける。`lazyOnload` は `defer`。明示的な `async` / `defer` が常に勝ち。`beforeInteractive` は非対応

### runtime が描画する形

各プラグインについて runtime が `publicHead(ctx)` (resp. `publicBodyEnd`) を呼び、descriptor を validate して reject を drop、残ったものを `<Fragment>` でラップ。root layout はその Fragment を直接埋め込みます:

```tsx
<head>{pluginHead}</head>
{/* … */}
<body>… {pluginBodyEnd}</body>
```

`cms.config.plugins` の順序は集約後も保たれます。

> **`publicHead` / `publicBodyEnd` はいつ描画される？**
> runtime は、ampless middleware が処理した公開リクエストでのみ
> これらのサーフェスの出力を描画します。`/admin`、`/login`、
> そして theme preview リクエスト（`?previewTheme=` /
> `?previewColorScheme=` iframe）では描画されません。これにより、
> GTM / GA / consent script が admin page view や live preview traffic で
> analytics を汚染することを防ぎます。この挙動は
> `@ampless/runtime` の npm update だけで反映され、サイトコードの変更は不要です。

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
<div className="prose">{await ampless.renderBody(post)}</div>
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

## 6a. 予約投稿とコンテンツイベント

ampless は**予約投稿**をサポートしています。`status: 'published'` かつ `publishedAt` が未来の投稿は、その時刻まで公開読み出しから隠されます。`publishedAt` を過ぎると、サイトの自然なキャッシュ有効期限（デフォルト ≤ ~5 分）の範囲内で公開されます — 秒単位の正確なトリガーはありません。

### イベントは保存時に発火する（`publishedAt` のタイミングではない）

`content.published`（および `content.updated`）は DynamoDB Streams 経由で**投稿が保存されたとき**に emit されます。`publishedAt` が到来したときではありません。つまり、`content.published` に反応するプラグインは、投稿が未来日時の場合、**その投稿が公開される前**に実行されます。

現在の投稿一覧から公開アセットを再構築する trusted プラグイン（RSS、sitemap、JSON インデックスなど）にとってはこれは問題ありません — `listPublishedPosts()` が未来日時の投稿をすでに除外しているため、再生成されたアセットはその投稿が公開されるまでリストに含まれません。

一方、**外部通知プラグイン**（webhook、プッシュ通知、SNS 投稿など）には影響があります。投稿の URL が 404 を返しているまたはホームページにリダイレクトされている間に通知が配信されてしまいます。

### 推奨パターン: `publishedAt` でゲートする

ディスパッチの前に `event.payload.publishedAt` を確認します。投稿が未来日時の場合はスキップまたは保留します:

```ts
hooks: {
  async 'content.published'(event, ctx) {
    const { publishedAt } = event.payload

    // 予約投稿には通知を送らない。イベントは保存時に発火するが、
    // 投稿が公開されるのは publishedAt になってから。
    if (publishedAt && new Date(publishedAt) > new Date()) {
      return
    }

    // 投稿は今すぐ公開状態 — 通知しても安全。
    await sendWebhook(event.payload, ctx)
  },
}
```

イベントペイロード内の `publishedAt` は UTC ISO 8601 文字列（`...Z`）です。`Date.now()` と比較する前に `new Date()` またはお好みの日付ライブラリでパースしてください。

### 今後の対応

`content.published` の発火を保存時ではなく `publishedAt` のタイミングに合わせる機能 — EventBridge Scheduler または DynamoDB TTL トリガー Lambda によるスケジューラーコンポーネントが必要 — は計画中の機能強化です。現リリースのスコープには含まれていません。それまでの間は上記のパターンが通知プラグインにおける推奨ガードです。

オペレーター視点からの `publishedAt` セマンティクスの全体像は [`docs/scheduled-publishing.md`](https://github.com/heavymoons/ampless/blob/main/docs/scheduled-publishing.ja.md) を参照してください。

---

### CSP nonce（Phase 1 予約）

CSP（Content Security Policy）は本番公開サイトのほぼ必須要件です。nonce 伝搬を後から追加した場合に既存プラグインが一斉に動かなくなるのを防ぐため、ampless は今のうちに API サーフェスだけ予約しておきます（Phase 1 は完全 no-op）。

3 層設計:

1. **`ctx.cspNonce?: string`** — `PluginPublicRenderContext` の型に予約済み。今のところ常に `undefined`。runtime はこのフィールドをまだ populate しません。middleware/SSR nonce threading は将来の CSP RFP とともに landing します。

2. **`descriptor.nonce: 'auto' | string`** — `inlineScript` と `script` の両 descriptor variant の型で受け入れられます。`'auto'` は将来の runtime スタンプ用 sentinel。その他の文字列は明示的リテラル。`undefined` は `nonce` 属性を emit しない（デフォルト、非 CSP サイトと後方互換）。Phase 1: runtime は受け入れますが伝搬しません。`nonce: 'auto'` を今日宣言することは前方互換性のヒントであり、描画 HTML を変更しません。

3. **`'cspReady'` capability** — name-only の declarative バッジ。将来の admin UI / サニティチェックの対象になります。Phase 1 では runtime の cross-check や enforcement は一切なし。

**対応方法:**

```ts
// src/index.ts
definePlugin({
  name: 'my-plugin',
  apiVersion: 1,
  trust_level: 'untrusted',
  capabilities: ['publicHead', 'cspReady'],
  publicHead: () => [{
    type: 'inlineScript',
    id: 'my-snippet',
    body: '...',
    nonce: 'auto',    // 前方互換性ヒント。Phase 1 では効果なし
  }],
})
```

npm 公開のスタンドアロンプラグインの場合は、`package.json#amplessPlugin.capabilities` も合わせて更新してください — static manifest と factory return value が一致しない場合、runtime cross-check が警告を出します:

```json
{
  "amplessPlugin": {
    "apiVersion": 1,
    "name": "my-plugin",
    "trustLevel": "untrusted",
    "capabilities": ["publicHead", "cspReady"]
  }
}
```

**`'cspReady'` の意味:**

- サイト全体の CSP 適合は middleware / レスポンスヘッダー / runtime が制御しない他の inline コンテンツにも依存します。
- middleware-driven nonce threading PR が landing した後は、`nonce: 'auto'` を持つ plugin-supplied script が runtime nonce スタンプの候補になります。
- `'cspReady'` は `create-ampless plugin --capabilities` には表示されません — reserved capability であり、scaffold はアクティブな enforcement を示唆しないよう除外しています。

---

## 6b. 投稿本文の差し替え: `contentFields` (Phase 7)

`contentFields` capability は、投稿本文の一部（tiptap ノード、または markdown の単独行 URL）を、プラグインが管理する React サブツリーで差し替える機能。`@ampless/plugin-youtube` / `@ampless/plugin-x-embed` が `https://youtu.be/...` URL を iframe プレーヤーに、`https://x.com/<handle>/status/...` URL を tweet blockquote に展開するために使う。

### 形

```ts
import { definePlugin, type ContentFieldRenderer } from 'ampless'

definePlugin({
  // ...
  capabilities: ['contentFields'],
  contentFields: [
    {
      kind: 'tiptap',
      nodeType: 'amplessYoutube',
      render: (node, ctx) => <YouTubeEmbed videoId={String(node.attrs?.videoId)} />,
    },
    {
      kind: 'markdown-url',
      pattern: /^https:\/\/youtu\.be\/([\w-]{11})$/,
      render: ({ match }, ctx) => <YouTubeEmbed videoId={match[1]!} />,
    },
  ],
})
```

各 renderer は `ampless.renderBody(post)` 内で本文を歩く runtime から server-side で呼び出される。戻り値は `ReactNode`。`PluginPublicRenderContext` (`ctx`) は `publicHead` / `publicBodyEnd` と同じものなので、`ctx.setting<T>(key)` も同じように使える。

### 2 種類の kind

- **`tiptap`** — `nodeType` (例: `'amplessYoutube'`) でキー付け。runtime の tiptap walker が `type` 一致のノードを見つけたら renderer を呼ぶ。デフォルトの switch-case レンダリングはバイパスされ、プラグインがサブツリー全体を所有する。
- **`markdown-url`** — anchored な `RegExp` (`^...$`) でキー付け。runtime は `marked.lexer` で markdown をトークン化し、内容全体が単独 URL の paragraph トークン (autolink / bare URL / `[text](url)`) のみについて pattern を試す。最初にマッチしたものが勝ち。capture group は `match[1]`, `match[2]`, ... でアクセス可能。

### 命名と一意性

- first-party プラグインは `ampless...` の camelCase プレフィックス（`amplessYoutube`, `amplessTweet` 等）を使い、コミュニティ製の `nodeType` と衝突しないようにしている。
- runtime は同じ `nodeType` / `pattern.source` の重複登録を起動時に throw で拒否する。先勝ち。v1 は multi-instance 非対応。

### markdown URL pattern のルール

- **必ず `^...$` で anchor する**。anchor なしだと段落内の URL が誤マッチし、周辺テキストが壊れる。
- runtime はマッチ前に前後の whitespace を trim するので、pattern 側で `\s*` を書く必要はない。
- 段落の唯一のトークンが `[caption](url)` の markdown link なら受理する。`[caption with link](url)` のように前後にテキストが混在するケースは対象外（正しい挙動: prose は本文に残すべきで、video embed にすべきではない）。

---

## 6c. ページレベルスクリプト: `publicPostScript` (Phase 7)

`publicPostScript` capability は、ページ上の投稿が必要とする `<script>` タグをプラグインから出力するためのもの。runtime は安定 `id` で dedupe するので、同一ページ内の複数 embed は 1 つの script タグに集約される。`@ampless/plugin-x-embed` がページに tweet embed がある場合のみ `https://platform.twitter.com/widgets.js` を 1 度だけ注入するのに使われている。

### 形

```ts
definePlugin({
  capabilities: ['contentFields', 'publicPostScript'],
  publicPostScript(post, ctx) {
    if (!hasTweetIn(post)) return []
    return [
      {
        id: 'amplessTweet:widgets',
        src: 'https://platform.twitter.com/widgets.js',
        async: true,
      },
    ]
  },
})
```

### テーマからの呼び出し

テーマは投稿本文の出力後に `{await ampless.publicPostScriptsForPage(posts)}` を呼ぶ。first-party テーマは post 詳細ページ / home ページ (featured 表示時) で自動的に呼び出す:

```tsx
<div>{await ampless.renderBody(post)}</div>
{await ampless.publicPostScriptsForPage([post])}
```

runtime は:

1. プラグイン × post 組ごとに `publicPostScript(post, ctx)` を呼ぶ。
2. `id` が空 / 非 string、`src` が http(s) でない、descriptor がオブジェクトでない、等を drop。
3. `id` で dedupe（先勝ち）。
4. `<Fragment>` で `<script src={src} async defer />` を出力。

### CSP の扱い

runtime は `src` のホスト allowlist を強制しない。CSP はサイト側エンジニアの責任（`next.config.ts` / middleware で `script-src` に script ホスト（例: `platform.twitter.com`）を追加）。各プラグインの README に書いてある。

---

## 6d. Admin エディタ拡張の配線 (Phase 7)

admin エディタに tiptap Node 拡張を提供するプラグインは、別途 `./editor` subpath の client-side エントリを出荷する。
`app/(admin)/admin/_editor-bootstrap.tsx` は `npm run update-ampless` によって**自動生成**される — 手動で編集してはならない。

### プラグイン著者向け

`package.json#amplessPlugin` に `editorExports` を宣言する:

```jsonc
// packages/plugin-youtube/package.json
"amplessPlugin": {
  "apiVersion": 1,
  "name": "youtube",
  "trustLevel": "trusted",
  "capabilities": ["contentFields"],
  "editorExports": "./editor"   // ← editor module のある subpath
}
```

その subpath から `editorExtension` を named export する:

```ts
// packages/plugin-youtube/src/editor.tsx
export const editorExtension = AmplessYoutubeNode   // tiptap Node または Extension
```

`package.json#exports` にも同 subpath を宣言すること（codegen がこれを検証する — 未宣言の場合は warning を出してそのプラグインをスキップする）:

```jsonc
"exports": {
  ".":       { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
  "./editor": { "import": "./dist/editor.js", "types": "./dist/editor.d.ts" }
}
```

### プラグインユーザー（サイトエンジニア）向け

1. `npm i @ampless/plugin-youtube@beta` — plugin を dependency として追加する。
2. `cms.config.ts` に登録してサーバーサイド renderer を有効化する。
3. `npm run update-ampless` — インストール済み plugin の manifest から `_editor-bootstrap.tsx` を自動再生成する。

生成されたファイルはリポジトリにコミットされ、以下のような内容になる:

```tsx
// app/(admin)/admin/_editor-bootstrap.tsx  (AUTO-GENERATED — 編集不可)
'use client'
// AUTO-GENERATED by `npm run update-ampless`. Do not edit — your changes
// will be overwritten on the next run.
import { installAdminEditorExtensions } from '@ampless/admin/editor'
import { editorExtension as __ampless_plugin_x_embed_editor } from '@ampless/plugin-x-embed/editor'
import { editorExtension as __ampless_plugin_youtube_editor } from '@ampless/plugin-youtube/editor'

export function EditorBootstrap({ children }: { children: React.ReactNode }) {
  installAdminEditorExtensions([
    __ampless_plugin_x_embed_editor,
    __ampless_plugin_youtube_editor,
  ])
  return <>{children}</>
}
```

このファイルは admin layout に渡される（テンプレートに既に組み込まれているので追加の作業は不要）:

```tsx
// templates/_shared/app/(admin)/admin/layout.tsx
import { createAdminLayout } from '@ampless/admin/pages'
import { EditorBootstrap } from './_editor-bootstrap'
export default createAdminLayout(admin, { editorBootstrap: EditorBootstrap })
```

`installAdminEditorExtensions` は idempotent で、render 時に client component 内で呼ばれる。admin の `<TiptapEditor>` は毎回 render 時に登録済みリストを built-in extensions の末尾に spread する。

`update-ampless` が生成する `_editor-bootstrap.tsx` は extensions、markdown アダプター、html アダプターの3つの install 呼び出しを含む:

```tsx
// app/(admin)/admin/_editor-bootstrap.tsx  (AUTO-GENERATED — 編集不可)
'use client'
// AUTO-GENERATED by `npm run update-ampless`. Do not edit ...
import { installAdminEditorExtensions, installAdminTiptapNodeMarkdown, installAdminTiptapNodeHtml } from '@ampless/admin/editor'
import * as __ampless_plugin_x_embed_editor from '@ampless/plugin-x-embed/editor'
import * as __ampless_plugin_youtube_editor from '@ampless/plugin-youtube/editor'

export function EditorBootstrap({ children }: { children: React.ReactNode }) {
  installAdminEditorExtensions([
    __ampless_plugin_x_embed_editor.editorExtension,
    __ampless_plugin_youtube_editor.editorExtension,
  ])
  installAdminTiptapNodeMarkdown([
    __ampless_plugin_x_embed_editor.tiptapNodeToMarkdown ?? {},
    __ampless_plugin_youtube_editor.tiptapNodeToMarkdown ?? {},
  ])
  installAdminTiptapNodeHtml([
    __ampless_plugin_x_embed_editor.tiptapNodeToHtml ?? {},
    __ampless_plugin_youtube_editor.tiptapNodeToHtml ?? {},
  ])
  return <>{children}</>
}
```

### フォーマット切り替えの可逆アダプター（`tiptapNodeToMarkdown` + `tiptapNodeToHtml`）

operator が admin UI でポストのフォーマットを切り替える場合（例: `tiptap → markdown`、`tiptap → html`）、admin はボディコンテンツを変換する必要がある。通常の prose node は tiptap の built-in レンダラーで処理されるが、**atom node**（`amplessYoutube` のような embed ブロック）は子要素を持たず、children が空のまま fallthrough し、embed が無音で消えてしまう。

2 つのアダプターで両方向を修正する:

| アダプター            | 方向                              | 出力 |
| --------------------- | --------------------------------- | ---- |
| `tiptapNodeToMarkdown`| `tiptap → markdown`               | bare URL 行（例: `https://youtu.be/<id>`） |
| `tiptapNodeToHtml`    | `tiptap → html`、`markdown → html`| 正規プレースホルダー div |

フォーマット切替で扱う 3 種類の正規 body 表現:

| フォーマット | 正規形 |
| ------------ | ------ |
| tiptap       | `{ type: 'amplessYoutube', attrs: { videoId, start } }` Node |
| markdown     | bare `https://youtu.be/<id>` URL 行 |
| html         | `<div data-ampless-youtube data-video-id="<id>" …>…</div>` |

プレースホルダー div は **admin format-switch 相互運用専用**の正規 HTML 形式: `Node.renderHTML` が emit し、`Node.parseHTML` の `tag: 'div[data-ampless-*]'` rule が復元することで、admin での `tiptap ↔ markdown ↔ html` 切替が embed を保ったまま round-trip できる。

**`format: 'html'` の公開描画は、plugin が `htmlPlaceholder` を宣言していればプレースホルダーを展開する。** 公開描画の 3 経路すべてが同じ `contentFields.tiptap` renderer に到達する: tiptap 投稿は React walker が `contentFields.tiptap` registry を参照（= `amplessYoutube` Node を実際の iframe に変換）、markdown 投稿は markdown walker が `contentFields.markdownUrl` を参照（= bare URL paragraph を実際の iframe に変換）、html 投稿は **public html walker** が `contentFields.htmlPlaceholder` を参照（= top-level の `<div data-ampless-youtube …>` プレースホルダーを実際の iframe に変換）。上の `tiptapNodeToHtml` アダプターは **admin format-switch** の交換形式のみを司り、その形式を公開描画時に展開させるのは `htmlPlaceholder` の宣言である（契約は下記の `htmlPlaceholder` セクションを参照）。`publicHtmlForPost` は従来どおり `beforeContent` / `afterContent` slot のみ提供する capability であり、body を変換しない。

embed node を持つが `htmlPlaceholder` を**宣言しない** plugin は従来挙動を維持する: `format: 'html'` 投稿の公開描画ではプレースホルダー div がリテラルにそのまま出力される（内側の正規 URL link は clickable なので graceful に degrade する）。その場合に iframe を得るには `tiptap` または `markdown` 形式で保存する。

#### アダプターの契約

両アダプターは同じシグネチャを持つ:

```ts
(node: TiptapRenderNode) => string | null
```

**文字列**（空文字 `''` も含む）を返すと、その出力を使う。**`null`** を返すとデフォルトの switch へ fallthrough する（対応しない node や video id が欠損している場合などに使う）。

```ts
// packages/plugin-youtube/src/editor.tsx
import type { TiptapNodeMarkdownAdapters, TiptapNodeHtmlAdapters } from 'ampless'

export const tiptapNodeToMarkdown: TiptapNodeMarkdownAdapters = {
  amplessYoutube: (node) => {
    const videoId = String(node.attrs?.videoId ?? '').trim()
    if (!videoId) return null   // fallthrough
    return `https://youtu.be/${videoId}`
  },
}

export const tiptapNodeToHtml: TiptapNodeHtmlAdapters = {
  amplessYoutube: (node) => {
    const videoId = String(node.attrs?.videoId ?? '').trim()
    if (!videoId) return null   // fallthrough
    const attrs = placeholderAttrs(node.attrs ?? {})
    // 内側のコンテンツは editor 用視覚 label (`<span>YouTube: id</span>`、
    // Node.renderHTML 専用) ではなく URL link にする。`format: 'html'` の
    // 公開描画ではこの body をリテラル表示するため editor 用 label が漏れる
    // のを防ぐ。viewer 側で iframe 展開されない場合でもクリック可能な link が
    // 残り graceful degradation する。markdown 正規形 (bare URL line) と
    // 対応する形式。parseHTML は `data-video-id` 属性を読むため内側コンテンツは
    // round-trip と無関係。
    const url = `https://youtu.be/${videoId}`
    return `<div ${attrsToHtmlString(attrs)}><a href="${escapeAttr(url)}">${escapeAttr(url)}</a></div>`
  },
}
```

#### 配線

`update-ampless` が各プラグインの `./editor` モジュールから `tiptapNodeToMarkdown` と `tiptapNodeToHtml` の named export を読み取り（namespace import `* as` 経由）、両方の install に自動で配線する。**手動での配線は不要。** プラグインがいずれかのマップを export しない場合、生成ファイルの `?? {}` fallback が no-op になる。

#### `markdown → html` 2-hop

`markdown → html` の方向は `tiptapNodeToHtml` アダプターを 2-hop 経由で再利用する:

1. `markdownToHtml(body)` — marked が markdown を HTML に変換。bare URL 行は `<p><a href="URL">URL</a></p>` になる。
2. `generateJSON(html, extensions)` — tiptap が HTML を parse。プラグインの `Node.parseHTML` `tag: 'p'` rule が bare URL の paragraph を embed Node に昇格する。
3. `tiptapToHtml(doc, { nodeAdapters })` — html アダプターが embed Node をプレースホルダー div に serialize する。

つまりプラグインは `tiptap → html` アダプターを 1 つ export するだけでよく、`markdown → html` の方向は tiptap の parse rule を通して自動的に再利用される。**重複ロジックは不要。**

#### Public html walker: `htmlPlaceholder`

`format: 'html'` 投稿のプレースホルダー div を公開ページで実 embed として描画するには、既存の `contentFields` の `tiptap` entry に **`htmlPlaceholder`** 宣言を追加する。**新しい renderer は書かない** — walker は tiptap entry が既に使う `render(node, ctx)` をそのまま呼ぶので、3 形式（tiptap / markdown / html）すべてが 1 個の renderer に到達し、描画が divergence しない。

```ts
// packages/plugin-youtube/src/index.tsx
contentFields: [
  {
    kind: 'tiptap',
    nodeType: 'amplessYoutube',
    render: (node) => {
      const videoId = String(node.attrs?.videoId ?? '')
      const startRaw = node.attrs?.start
      const start =
        typeof startRaw === 'number' && Number.isFinite(startRaw) ? startRaw : undefined
      return <YouTubeEmbed videoId={videoId} start={start} />
    },
    htmlPlaceholder: {
      // top-level プレースホルダー div を識別する marker attribute。
      flagAttr: 'data-ampless-youtube',
      // div の HTML 属性を render が期待する tiptap node attrs に変換する
      // — 型も正しく。walker は型を知らないのでここで変換する
      // （例: data-start string → number）。
      attrsFromElement: (attribs) => {
        const start = Number(attribs['data-start'])
        return {
          videoId: attribs['data-video-id'] ?? '',
          start: Number.isFinite(start) ? start : undefined,
        }
      },
    },
  },
  // …markdown-url entry は変更なし…
]
```

`format: 'html'` 投稿の公開描画時、runtime は body を server-side で parse し（`htmlparser2`）、`flagAttr` を持つ **top-level** element ごとに `{ type: nodeType, attrs: attrsFromElement(attribs) }` node を組んで `render(node, ctx)` を呼ぶ。それ以外はすべて **元文字列の slice**（byte 単位で完全保存、DOM の再シリアライズなし）として passthrough する。

把握すべき制約:

- **top-level のみ。** `<blockquote>` / `<li>` 等の内側に nest したプレースホルダー div はリテラルのまま — editor の body-level-only な `parseHTML` fallback と整合。展開されるのは depth-0 の element のみ。
- **`flagAttr` は case-insensitive で照合される。** htmlparser2 は parse 時に HTML 属性名を小文字化し、runtime は登録時に `flagAttr` を小文字化するため、`<div DATA-AMPLESS-YOUTUBE …>` も `<div data-ampless-youtube …>` も展開される。`flagAttr` は任意の属性名でよい — site-local plugin は `data-my-embed` を使える。固定の `data-ampless` prefix 要件はない。
- **graceful degradation。** `attrsFromElement` または `render` が throw した場合、runtime は `console.warn` を出力し **元のプレースホルダー slice**（内側の正規 URL link は clickable のまま）に fallback する。engineer が書いた本文を消さない。
- **page-level script。** embed が third-party script を要する場合（例: x.com の `widgets.js`）、`publicPostScript` / 検知ヘルパーもプレースホルダー形式を認識する必要がある。`plugin-x-embed` の `hasTweetIn` は `format: 'html'` body 内で `twitter-tweet` と `data-ampless-tweet` の両方を match させ、展開された blockquote を hydrate するため widgets.js を注入する。

**wrapper 境界の変化。** プレースホルダーを含まない `format: 'html'` 投稿は単一の wrapper `<div>` として出力される（fast path — 従来の raw passthrough と markup 完全一致）。プレースホルダーを**含む**投稿は **複数の wrapper div と React embed の兄弟列が交互に並ぶ**構造になる: 各 raw chunk 内の bytes は正確に保存されるが、wrapper 境界は移動する。body 全体を 1 個の wrapper で囲む前提の direct-child / adjacent-sibling CSS selector は従来と同じには効かない。これは embed を in-place 展開するための許容トレードオフ。

### markdown → tiptap の復元

editor Node が markdown へ bare URL line として serialise される場合、逆方向の復元は paste rule ではなく `Node.parseHTML()` で扱う必要がある。admin の `markdown → tiptap` format switch は、まず markdown を HTML に変換する。GFM autolink により bare URL line は `<p><a href="https://...">https://...</a></p>` になり、その HTML を tiptap が document として parse する。paste rule は user paste / typing event 用なので、この HTML parse 経路では発火しない。

embed 系 Node は、上記 paragraph shape 用の high-priority parse rule を追加し、必要に応じて他の HTML-to-tiptap 経路向けに `a[href]` rule も追加する。paragraph rule は「paragraph が単一 link だけを含み、その link text が `href` と同じ」場合だけ match させる。これにより parser は paragraph 全体を block embed Node に置換でき、embed の前に空 paragraph が残らない。`getAttrs` は URL を検証し、match しない link では `false` を返して通常の Link mark にフォールバックさせる。

### active source と完全無効化

**エディタ配線の active source は `package.json#dependencies`**（= `node_modules`）であり、`cms.config.ts` ではない。

- plugin を `cms.config.ts` から外しても `package.json` に dep が残っていれば、editor の paste rule は**有効のまま**になる。editor は tiptap document にそのノード型を挿入できるが、公開 renderer はレンダリングしない（不整合状態 — 避けること）。
- 完全に無効化するには: `cms.config.ts` から削除 **かつ** `npm uninstall @ampless/plugin-...` を実行し、`npm run update-ampless` で bootstrap ファイルを再生成する。

### エディタプレビューのパイプライン

admin の edit / new post フォームは preview ペインを `<iframe sandbox="allow-scripts allow-same-origin">` で表示する。`srcDoc` はテンプレート側 preview Route Handler が返す HTML。テンプレート scaffold は handler を `app/(admin)/admin/preview/route.tsx` に同梱する:

```tsx
// templates/_shared/app/(admin)/admin/preview/route.tsx
import type { Post } from 'ampless'
import { admin } from '@/lib/admin'

export async function POST(req: Request): Promise<Response> {
  const session = await admin.getServerSession()
  if (!admin.isEditor(session)) {
    return new Response('Forbidden', { status: 403 })
  }
  let draft: Post
  try {
    draft = (await req.json()) as Post
  } catch {
    return new Response('Bad Request', { status: 400 })
  }
  const ampless = await admin.getAmpless()
  const node = (
    <>
      {await ampless.renderBody(draft)}
      {await ampless.publicPostScriptsForPage([draft])}
    </>
  )
  // dynamic import: 下の「Server Action ではなく Route Handler を採用した理由」参照。
  const { renderToStaticMarkup } = await import('react-dom/server')
  return new Response(renderToStaticMarkup(node), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
```

`<PostForm>` / `<PostHistoryPanel>` は素のままで `/admin/preview` に draft を POST する — call site で追加の wiring は不要:

```tsx
// templates/_shared/app/(admin)/admin/posts/[postId]/page.tsx
import { admin } from '@/lib/admin'
import { createEditPostPage } from '@ampless/admin/pages'

export default createEditPostPage(admin)
```

admin が非デフォルトパス（Next.js `basePath` やカスタム prefix）にマウントされている場合は、page factory の `previewEndpoint` option で endpoint を上書きできる:

```tsx
export default createEditPostPage(admin, { previewEndpoint: '/cms/admin/preview' })
```

Server Action ではなく Route Handler を採用した理由: `'use server'` モジュール内部で `react-dom/server` 由来の rendering を行うと、Next.js 15+ が edit-post page の compile に失敗する。build 時に Client Component から Server Action モジュール経由で import graph を辿るため、その経路上で `react-dom/server` に到達した時点で「You're importing a component that imports react-dom/server」チェックが発火する。Route Handler に切り出すことで rendering を import graph から完全に切り離せる — `<PostForm>` は plain な HTTP endpoint を fetch するだけで、bundler は form から handler 側へ踏み込まない。さらに handler 自身が `admin.isEditor()` を明示的にチェックすることで、将来 `(admin)` route-group gate が誤設定された場合の安全側のフェールセーフになる。`react-dom/server` の import 自体を dynamic にしているのは Next.js 16 の Turbopack が、Route Handler を含む app router build 経路で reach できる top-level の `react-dom/server` static import を一律で flag するため。request 時に解決することで build-time import-graph walker から外しつつ、runtime では同じ Node.js subpath からロードする。

**Preview iframe sandbox — v1 trust boundary 拡張:** iframe は `sandbox="allow-scripts allow-same-origin"` を使う。`srcDoc` とともに使用すると iframe は admin の origin を継承し、サードパーティ embed widget（YouTube SDK、x.com `widgets.js`）が動作できるようになる — opaque-origin（`allow-scripts` のみ）の iframe では動作を拒否する（非 HttpOnly storage / cache へのアクセスと real-origin requests が必要なため）。同時に same-origin により preview スクリプトは admin の auth state / 非 HttpOnly storage / DOM へのアクセスと authenticated same-origin XHR / fetch の発行が可能になる。

これは単なる sandbox 緩和ではなく、**v1 の明示的な設計判断**です: **ampless v1 は admin preview content / plugin script を全部 trusted とみなす**。エンジニアは npm install 前に plugin を審査するし（カスタマイズベース CMS モデル）、body content はこのサイトの trusted editor が作成する。`<PostHistoryPanel>` では別の editor が作成した過去 revision（revision author ≠ preview viewer）をプレビューするケースも通常発生するが、v1 ではそれも明示的に trust ring 内と位置づける。より安全な代替案（別 origin preview route + CSP / COEP / COOP）は v2.0+ でリアルなプラグインマーケットプレイスが必要になった場合に再検討する。

---

## 7. 非同期イベントフック

`hooks` は SQS から到着したイベントを trust_level に対応する processor Lambda が受けて実行します。

### 戻り値の予約

`PluginEventHandler` の戻り値型は `Promise<void | PluginHookResult>`。
runtime は現状この戻り値を完全に無視する — 既存 plugin が
`Promise<void>` を返す形は migration 不要で動き続ける。
`PluginHookResult` は将来の directive (最初の用例として有力:
`metrics?: Record<string, number>` による observability emission) のた
めの予約で、今宣言するのは forward-compatibility のヒントとして
の扱い。注意: rewrite / cancel 系 directive は本 widening だけで
は有効化されない — `before:*` event の plugin 配線と payload 拡張
が別 PR で必要。

`PluginHookResult` には private な `__amplessPluginHookResult`
marker が付いており、union が `Promise<string>` / `Promise<number>`
等の無関係な promise を silently 受け入れないようになっている —
plugin 作者がこの marker を明示的に設定する必要は無い。

### Runtime context

runtime context (`ctx`) の中身:

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

- KvStore とは **別テーブル** の `PluginSecret` DynamoDB テーブルに保存。admin/editor Cognito ユーザーは AppSync 経由でこのテーブルに**直接アクセスできない** — すべての書き込みは `setPluginSecret` mutation を通じて `plugin-secret-handler` Lambda 経由で行われる。
- 値は保存前に **AES-256-GCM 暗号化**される。admin ブラウザが plaintext を Lambda に TLS 経由で送信 → Lambda がバリデーション + `process.env.PLUGIN_SECRET_ENCRYPTION_KEY`（CDK が `amplify/secrets/encryption-key.ts` から注入）から鍵を読み取り + 暗号化 → ciphertext のみを DDB に書き込む。平文は DynamoDB に保存されず、ブラウザにも返らない。
- **脅威モデル（Phase 6a v2.2）**:

  | 脅威 | 状態 |
  |---|---|
  | PluginSecret テーブルを閲覧する AWS Console オペレータ | ✓ 対策済み — ciphertext のみ、DDB に鍵なし |
  | ソースリポジトリ / デプロイアーティファクトへのアクセス | ⚠ 対策なし — 鍵は `amplify/secrets/encryption-key.ts` に存在。public repo では `npx create-ampless@beta setup-encryption-key --gitignore` などで鍵を version control から外し、デプロイアーティファクトアクセスを制限すること |
  | 同一 Lambda 内の悪意ある trusted plugin | ✗ 対策なし — `process.env.PLUGIN_SECRET_ENCRYPTION_KEY` はプラグインコードから読める。真の分離 = per-plugin Lambda（privileged tier, ロードマップ） |
  | S3 mirror 漏洩 | ✓ 対策済み — PluginSecret テーブルは mirror されない |

- trusted-processor Lambda が `node:crypto` で復号する。`ctx.secret<T>(key)` は平文 string を返す（ciphertext ではない）。
- S3 mirror 経路に絶対に流れない（mirror は KvStore のみを query する）。
- 公開 render surface (`publicHead` など) からは読めない。
- **field manifest 検証の範囲**: admin クライアントは UX フィードバック目的で `pattern` / `maxLength` / `required` を検証するが、Lambda 側は **汎用の 10,000 文字ハードキャップと安全文字サニタイザのみ**を強制する。admin/editor が AppSync mutation を直接呼ぶと field 単位の制約は迂回できる。設計上意図したもので、admin/editor は secret 設定を許可された信頼されたオペレータと位置づけている。manifest チェックは UX ガイダンスであり、セキュリティ境界ではない。

### 要件と `definePlugin()` の挙動

`settings.secret` は `definePlugin()` 時に 4 つの observable な挙動を持ちます（これは v1 のファーストパーティ organization のシークレットアクセス hard gate; [plugin.ts:1004-1019](https://github.com/heavymoons/ampless/blob/main/packages/ampless/src/plugin.ts#L1004-L1019) 参照）:

1. **`settings.secret` 非空 + `trust_level !== 'trusted'`** → `definePlugin()` が **throw**。untrusted と privileged Lambda は `PluginSecret` テーブルへの IAM read アクセスを持たない; trusted Lambda の IAM 権限が必要。
2. **`settings.secret` 非空 + `capabilities` 宣言済み + `capabilities` に `'secretSettings'` が含まれない** → **soft 不一致 warning**。`'schema'` / `'publicHtmlForPost'` の既存 capability-mismatch パターンと同じ。
3. **`settings.secret` 非空 + `capabilities` 未定義**（`capabilities` 配列を持たない legacy プラグイン）→ **warning なし**。`capabilities` が `undefined` のとき不一致チェックをスキップ、後方互換のため。
4. **`capabilities: ['secretSettings']` 宣言だけで `settings.secret` フィールドなし** → **no-op**。warning も throw もなし。

`settings.secret` を使うには以下も必要です:
1. `trust_level: 'trusted'`（上記 #1 の要件; それ以外は `definePlugin()` が throw）。
2. `capabilities` に `'secretSettings'` を含める（`capabilities` が定義されているとき省略すると console.warn）。
3. **鍵の初回セットアップ** — プロジェクトルートで実行:
   ```sh
   npx create-ampless@beta setup-encryption-key
   ```
   32 バイトのランダムな鍵を生成し、`amplify/secrets/encryption-key.ts` に書き込む。AWS 認証情報不要 — ローカルファイル操作のみ。

   次に `amplify/backend.ts` でその定数を import し、`defineAmplessBackend({ pluginSecretEncryptionKey })` に渡す。その後デプロイ（またはサンドボックス再起動）して Lambda env var に注入する。

   public リポジトリの場合は `--gitignore` を渡してバージョン管理から除外し、鍵を別途配布する。

### Dual-write 整合性

`setPluginSecret` と `clearPluginSecret` は各操作で **2 テーブル**に連続して書き込む: `PluginSecret`（ciphertext）と `PluginSecretIndicator`（存在タイムスタンプ）。2 回目の書き込みが失敗した場合、テーブルは以下の予測可能な状態になる:

| 障害ポイント | `PluginSecret` | `PluginSecretIndicator` | `ctx.secret()` | `hasPluginSecret()` |
|---|---|---|---|---|
| **set**: indicator PutItem 失敗 | ciphertext 存在 | 不在 | plaintext を返す ✓ | `false`（UI: 「未保存」） |
| **clear**: indicator DeleteItem 失敗 | 不在 | stale（古いタイムスタンプ） | `undefined` ✓ | `true`（UI: 「保存済み」） |

clear パスの失敗は「安全側」: secret は発火しなくなるが、UI は一時的に「保存済み」と表示する。set パスの失敗は軽微な UI 不整合: secret は機能するが、存在インジケータはリトライが成功するまで不在となる。

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
- 結果は per-invocation キャッシュされる。同 batch 内で同キーを 2 回呼んでも DDB 呼び出しと復号処理は 1 回ずつ。暗号化キーは Lambda env var から cold-start 時に decode される（DDB への余分な fetch は不要）。
- キャッシュされる値は **復号済みの平文** — ciphertext ではない。2 回目の呼び出しで再復号は発生しない。
- cache key は namespace 化される: `${instanceId ?? name}:${fieldKey}`。異なる plugin instance が同名フィールドを持っても混線しない。

### admin UI

`settings.secret` を宣言すると、admin plugin settings ページの public フィールドの下に **Secret settings** セクションが表示されます。各フィールド:

- **未保存**: 通常テキスト入力 + Save ボタン。
- **保存済み**: マスク表示 `••••••••` + Replace + Clear ボタン。値は絶対に取得・表示されない。
- **編集中**: Replace クリック後 — 新値入力 + Save + Cancel。

admin は再デプロイなしにいつでも secret をローテーションできます。保存後 ~5〜10 秒以内に次の trusted Lambda 実行から新値が使われます。

---

## 9b. プラグインのデータの保存場所

プラグインが所有するデータは以下の 5 つのストレージ領域に置かれる可能性があり、**現状の書き込み経路は領域ごとに異なります**。3 つのファミリに分かれます:

- **KvStore** — admin/editor が AppSync 経由で書き込みます。プラグインの hook には KvStore write helper は提供されていません。
- **PluginSecret + PluginSecretIndicator** — `plugin-secret-handler` Lambda が書き込みます。admin/editor が `setPluginSecret` / `clearPluginSecret` AppSync mutation を呼ぶと、handler Lambda が DDB に書く流れです。trusted processor は `ctx.secret<T>()` で `PluginSecret` を読み取りますが、どちらの secret テーブルにも書き込みません。
- **S3 `public/plugins/{instanceId ?? name}/*`** — trusted Lambda の hook context (`ctx.writePublicAsset(...)`) から書き込みます。プラグインの hook が直接書き込めるのはこの領域だけです。

それ以外 — `Post`、`Page`、`Media`、`PostTag` DynamoDB テーブル、`public/site-settings.json` S3 ミラー、他プラグインの namespace — への書き込みは禁止です。現状 runtime が強制しているわけではなく、信頼（および将来の IAM 強化）によって担保されます。

| 領域 | パス / 識別子 | アクセスレベル | Phase |
|---|---|---|---|
| KvStore（admin 設定） | DynamoDB `pk='siteconfig'`、`sk='plugins.<instanceId>.<fieldKey>'` | admin/editor が AppSync 経由で書く（プラグインの hook context には KvStore write helper は現状提供されていない） | Phase 2 |
| KvStore（runtime 状態/キャッシュ） | DynamoDB `pk='pluginstate:<plugin>:...'`（TTL 任意） | admin/editor が AppSync 経由で書く（プラグインの hook context には KvStore write helper は現状提供されていない） | 現行 |
| PluginSecret | DynamoDB `PluginSecret` テーブル、`sk='plugins.<instanceId>.<fieldKey>'` | `trusted` 限定（IAM 専用 AppSync 認証） | Phase 6a |
| PluginSecretIndicator | DynamoDB `PluginSecretIndicator` テーブル、`sk='plugins.<instanceId>.<fieldKey>'` | `trusted` + admin/editor（indicator 読み取り） | Phase 6a |
| S3 プラグイン成果物 | `public/plugins/{instanceId ?? name}/*` | `trusted` 限定（`writePublicAsset`） | Phase 3 |

**cleanup は自動ではありません。** `cms.config.ts` からプラグインを外しても、5 領域のデータは自動削除されません。将来の lifecycle-dispatch PR が `uninstall` フックの起動メカニズムを追加するまで（§9c 参照）、オペレータによる手動削除が必要です。

**独自 DynamoDB テーブル。** プラグインが ampless スキーマ外に独自の DynamoDB テーブルを持つ場合、lifecycle 管理（アンインストール時の cleanup を含む）はプラグイン著者の責任です。ampless は外部テーブルを把握しておらず、将来の `uninstall` cleanup grant は上記 5 領域のみをカバーします。

詳細な設計根拠と IAM grant 設計については [`docs/architecture/08-plugin-architecture.ja.md`](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.ja.md#プラグインが所有するデータ領域) を参照してください。

---

## 9c. `uninstall` フック（Phase 1 予約）

`AmplessPlugin.uninstall` は **Phase 1 型予約** です — 現在 runtime はこれを呼び出しません。hook 名とシグネチャをプラグインコードが出回る前に確定し、将来の lifecycle-dispatch PR が名前・形を変更せずに起動を配線できるようにするのが目的です。

**Phase 1 スコープ**: hook 名とシグネチャのみ予約。`ctx` には cleanup helper (`deletePublicAsset` / `deletePluginSetting` / `deletePluginSecret`) がまだありません — 今日 `await ctx.deletePublicAsset(...)` と書くと TypeScript エラーです。これらの helper が lifecycle-dispatch PR で追加される際は `PluginUninstallContext` への追加（additive）であり、空のボディを宣言済みのプラグインへの破壊変更はありません。

**今日の推奨宣言** — 空のボディ:

```ts
// 例: S3 成果物と secret を書く trusted plugin
definePlugin({
  name: 'my-trusted-plugin',
  apiVersion: 1,
  trust_level: 'trusted',
  capabilities: ['eventHooks', 'writePublicAsset', 'secretSettings'],
  hooks: { 'content.published': async (_evt, ctx) => { /* ... */ } },
  uninstall: async (_ctx) => {
    // Phase 1 予約: runtime は今日このフックを呼び出しません。
    // また `ctx` には cleanup helper
    // (`deletePublicAsset` / `deletePluginSetting` /
    // `deletePluginSecret`) がまだありません。
    // 空ボディを宣言しておくのが forward-compat の推奨形です —
    // 将来 lifecycle-dispatch PR がリリースされたとき、helper が
    // `PluginUninstallContext` に追加され、そこで cleanup ボディを
    // 実装します。今日の空宣言を再パブリッシュしなくても呼び出し
    // イベントは受け取れますが、実際の cleanup ボディを追加するには
    // 再パブリッシュが必要です。
  },
})
```

**冪等性。** lifecycle-dispatch PR がリリースされると、`uninstall` フックは trusted Lambda の IAM コンテキストで実行されます。SQS 配送は at-least-once なので cleanup ボディが複数回実行される可能性があります。安全にリトライできるよう設計してください（S3 の `deleteObject` は冪等、DDB の conditional delete も key が消えていれば safe）。

---

## 9d. settings の形状を変えるとき（Phase 1 予約）

### 今日の挙動: `public` と `secret` は別の経路を辿る

形状変更は今日の runtime で silently 吸収されますが、実際の挙動は `settings.public` と `settings.secret` で異なります。両者は完全に別の write/read パスを使っているためです。

#### `settings.public`（`resolvePluginSettings` の寛容な resolver）

`resolvePluginSettings`（[packages/ampless/src/plugin-settings.ts](packages/ampless/src/plugin-settings.ts)）は `manifest.public` のみをイテレートし、field ごとに `field.default` にフォールバックします。resolver は `manifest.secret` を一切見ません。

| 変更 | 今日の挙動（public フィールド） |
|---|---|
| **フィールド追加** | 新フィールドは `manifest.default` から解決されます。ストレージに値がないため default が使われます。 |
| **フィールド削除** | KvStore に orphan row が残ります。`resolvePluginSettings` は現在の manifest にない key を silently skip します。 |
| **フィールド改名**（`endpoint` → `url`） | 削除 + 追加として扱われます。旧値は到達不能（orphan）になり、新フィールドは `default` から解決されます。 |
| **型を非互換に変更** | 新しい validator がストレージの値に対して実行されます。通過すれば値が使われ、失敗すれば `default`（または `undefined`）にフォールバックします。 |

#### `settings.secret`（admin UI + `PluginSecret` + `ctx.secret()`、寛容な resolver なし）

Secret フィールドは `resolvePluginSettings` から一切読まれません。別の経路を辿ります:

- admin UI が `setPluginSecret` AppSync mutation 経由で値を 1 つずつ書き、`plugin-secret-handler` Lambda が暗号化して `PluginSecret` DynamoDB テーブルに格納
- trusted hook が `ctx.secret<T>(key)` で key 単位で直接 `PluginSecret` から復号読み取り
- `PluginSecretField` 型は `default` を持てない（型レベルで禁止）。manifest レベルのフォールバックは存在しない

| 変更 | 今日の挙動（secret フィールド） |
|---|---|
| **フィールド追加** | admin UI に新フィールドが表示されます。admin が値を設定するまで `ctx.secret<T>(key)` は `undefined` を返します。 |
| **フィールド削除** | admin UI から消えますが、`PluginSecret` 内の暗号化された row は orphan として残ります。resolver は走らないため、operator が手動で削除する必要があります。 |
| **フィールド改名** | 旧 key の暗号化された row は orphan になります（resolver / cleanup なし）。新 key は未設定として表示され、admin が新 key に値を入れ直す必要があります。 |
| **型を非互換に変更** | `validatePluginSettingValue` は write 時のみ実行されます。既存の暗号化値は read 時には影響を受けず、`ctx.secret<T>(key)` は最後に書かれた値を返します。新しい入力を admin が保存しようとすると新 validator で reject される、というだけです。 |

これらのケースでエラーや警告は発生しません。形状変更後の挙動を確認するには、プラグイン著者が手動でストレージの値を確認する必要があります。

### `version` 予約について

`PluginSettingsManifest.version?: number` は **Phase 1 型予約** です。runtime は今日このフィールドを読みません。宣言しても上記の寛容な resolver の挙動は変わりません。

この予約は、将来の migration PR がストレージの値に manifest の version をどこかに保存し、resolve 時に `manifest.version` と比較してミスマッチを検出できるようにするためのものです。ミスマッチ時の応答（warn / skip / in-place migration / admin 主導フローなど）はその future PR の設計領域です。

**`version` を宣言しても今日保証されないこと:**

- migration ボディは実行されません。
- ストレージの値の再検証・再 default も行われません。
- `migrate` hook のシグネチャは予約されていません（それは別の future 設計）。

**`version` を今日宣言することで得られるもの:**

- その PR がリリースされた後に `version` フィールドを追加するためだけの再パブリッシュが不要になります（将来の migration 検出パスに最初から参加できます）。
- manifest に versioned な形状であることを将来のメンテナーに伝えます。

### 推奨パターン

| シナリオ | 推奨 |
|---|---|
| 追加のみの変更（新しいオプションフィールド、default あり） | `version` の bump 不要。寛容な resolver が吸収します。 |
| 非互換変更（改名、型変更、意味的変化） | `version` を 1 増やします。 |
| 既存 manifest に初めて `version` を追加する | `version: 1` から始めます。 |

**正の整数、1 始まりを使用してください。** `0`、負数、小数は使わないでください。`number` 型はそれらを受け入れますが、将来の migration PR が `0` / undefined に特別な意味（legacy / pre-v1 との混同を避けるため）を予約する可能性があります。

### コード例

```ts
definePlugin({
  name: 'my-plugin',
  apiVersion: 1,
  trust_level: 'untrusted',
  capabilities: ['adminSettings'],
  settings: {
    version: 2,           // ← Phase 1 reservation。今日の runtime は無視します。
    public: [
      { type: 'url', key: 'webhookUrl', label: 'Webhook URL', required: true },
    ],
  },
})
```

将来の migration PR がリリースされると、すでに `version` を宣言しているプラグインは自動的に検出パスに乗ります。実際の migration ボディを提供したいプラグインは、その PR がリリースされてから再パブリッシュしてボディを追加する必要があります。`version` を省略したプラグインは引き続き現在の寛容な resolver の挙動のままで変化ありません。

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
- **`apiVersion`**: 現状は `1` を declare してください — 唯一の有効値で、literal type が他の値を compile-time に reject します。`apiVersion` はプラグイン契約の **breaking-change marker** であって semver 風のチャンネルではありません。additive な追加 (optional field、reserved capability など) は `apiVersion: 1` 内に収まり、bump は不要です。詳細は architecture doc の [apiVersion bump policy](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.md#apiversion-bump-policy) を参照
- **Dist-tag**: ampless 自体が beta のうちは `@beta`。`@latest` は ampless v1.0 まで予約

参考実装:

- [`packages/plugin-analytics-ga4`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-analytics-ga4) — descriptor ベース、Phase 2 settings
- [`packages/plugin-gtm`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-gtm) — `publicHead`（ローダーインラインスクリプト）+ `publicBodyEnd`（`<noscript>` iframe フォールバック）を両方使用、コンテナ ID は admin 編集可能
- [`packages/plugin-plausible`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-plausible) — `data-*` attrs 付きの単一 `<script>` descriptor、`required` な URL field（self-hosted Plausible 上書き対応）
- [`packages/plugin-rss`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-rss) — trusted、非同期 hooks + `writePublicAsset`
- [`packages/plugin-seo`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-seo) — `metadata()` + `siteMetadata()`
- [`packages/plugin-webhook`](https://github.com/heavymoons/ampless/tree/main/packages/plugin-webhook) — trusted hook + 外向き HTTP + `secretSettings` (admin 管理の signing secret、Phase 6a)
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
npx create-ampless@beta plugin my-thing \
  --trust-level untrusted \
  --capabilities publicHead,adminSettings

# スタンドアロン npm パッケージ: ./<dir>/ を生成
# package.json / tsconfig.json / tsup.config.ts / README + .ja /
# CHANGELOG / .gitignore / src/index.ts + src/index.test.ts を含む
# 新しいパッケージディレクトリを置きたい場所で実行する
npx create-ampless@beta plugin @myscope/ampless-plugin-thing \
  --standalone \
  --trust-level untrusted \
  --capabilities publicHead,adminSettings \
  --description "このプラグインが何をするか"
```

スタンドアロンスキャフォールドには Phase 5 のクロスチェックに必要なものがすべて含まれます: `package.json#amplessPlugin`、`./package.json` サブパスエクスポート、`packageName` ファクトリフィールド、`ampless-plugin` 検索キーワード、そして `pnpm install && pnpm test && pnpm build` が生成直後にクリーンに通る最小の vitest サンプル。

どちらのモードも、フラグなしの位置引数呼び出し (`npx create-ampless@beta plugin`) で @clack のプロンプト UI を使ったインタラクティブモードに切り替えられます。

### スタンドアロンプラグインの公開

```bash
cd ampless-plugin-thing
pnpm install
pnpm test
pnpm build
pnpm publish --access public --tag beta
```

スコープ付き名前 (`@scope/...`) には `--access public` が必須です。`--tag beta` は現在の ampless プレリリースサイクルに合わせています — 安定 major に達したら外してください。

`npm publish` が返った直後に `npm install <pkg>@beta` で 404 が出ることがあります（CDN とレジストリレプリカの伝播遅延）。その場合は 1〜2 分待ってリトライしてください — `npm view <pkg>@beta version` がレジストリで見えていることは必要条件ですが十分条件ではありません。

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

上記の GitHub URL は public beta repo で解決されます。同じ docs は package tarball 内の `node_modules/ampless/docs/` にも同梱されているので、この repo を checkout しなくてもローカルで読めます。
