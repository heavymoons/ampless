<!--
  Source of truth lives in packages/ampless/docs/plugin-author-guide.md.
  Keep both copies in sync — the scaffold copy at
  templates/_shared/docs/plugin-author-guide.ja.md must mirror this file
  byte-for-byte until we add a CI check.
-->

> English: [plugin-author-guide.md](./plugin-author-guide.md)

# ampless プラグインの書き方

このガイドは、初めての `definePlugin()` 呼び出しから admin 編集可能な設定パネル、そして npm 公開に至るまで、ampless プラグインを ship するために必要な手順を一通りカバーします。Phase 1 + Phase 2 の機能を網羅 — descriptor ベースの `<head>` / `<body>` 注入、非同期イベントフック、admin 管理の `settings.public` 値です。

設計の経緯と背景は [`docs/architecture/08-plugin-architecture.md`](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.md) に集約。本ページはその実装ハンドブック側です。

---

## 1. プラグインで何ができるか

ampless プラグインは `AmplessPlugin` オブジェクトを返す TypeScript モジュールです。以下のうち 1 つ以上のサーフェスにフックします:

| サーフェス | 実行場所 | 同期 / 非同期 | Phase |
|---|---|---|---|
| `metadata(post, site)` | 投稿の `generateMetadata()` | 同期 | 既存 |
| `siteMetadata(site)` | root layout の `generateMetadata()` | 同期 | 既存 |
| `publicHead(ctx)` | root layout の `<head>` | 同期 (async layout から呼ばれる) | 1 |
| `publicBodyEnd(ctx)` | root layout の `<body>` 末尾 | 同期 | 1 |
| `ogImage` | `/og/[slug]` ルート | リクエスト時、公開 Lambda 内 | 既存 |
| `hooks` | trust_level に応じた processor Lambda | 非同期、SQS イベントで起動 | 既存 |
| `settings.public` | `/admin/plugins` フォーム | 宣言的なマニフェスト | 2 |

**現時点でできないこと** (将来の privileged 層実装に依存、ロードマップ参照):

- 任意の `ReactNode` をページに注入 — descriptor 変種のみ許可
- 公開 Next.js プロセス内で TCP ソケットを開く。trusted Lambda も外向き HTTP のみ
- admin ルート / server ルート / コンテンツフィールドの追加 — Phase 6b 予約
- secret の読み書き。`secretSettings` capability は Phase 6a 予約

---

## 2. 最小ファイル構成

プラグインは小さな npm パッケージとして公開しても、サイトのモノレポ内に置いてもよいです。on-disk の構成はどちらでも同じ:

```
my-plugin/
  package.json
  tsconfig.json
  tsup.config.ts
  src/
    index.ts
    index.test.ts
```

本レポ内の `packages/plugin-rss/` と `packages/plugin-analytics-ga4/` が動作する参考実装です。

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

**公開 Next.js プロセス** (サイト訪問者のリクエストスレッド) 内で実行されます。AWS に対しては純 (IAM・ネットワーク無し) で、同期実行です。

| サーフェス | 戻り値 | 用途 |
|---|---|---|
| `metadata(post, site)` | `PluginMetadata` (Next.js `Metadata` 形) | 投稿単位の `<title>` / OGP / Twitter / canonical |
| `siteMetadata(site)` | `PluginMetadata` | サイト全体の `<title>` / favicon / RSS `<link rel="alternate">` |
| `publicHead(ctx)` | `PublicHeadDescriptor[]` | 解析ローダー、フォント、jsonld、hreflang |
| `publicBodyEnd(ctx)` | `PublicBodyDescriptor[]` | GTM no-script フレーム、チャットウィジェット、末尾スニペット |

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

`publicHead` と `publicBodyEnd` は **descriptor オブジェクト** を返します。`ReactNode` ではありません。runtime が validation してから React 要素を組み立てます。これが untrusted コードを公開描画パスで動かすための安全境界です。

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

`key` は相対 asset key である必要があります。空文字、絶対パス、`.` / `..` path segment、backslash、制御文字、256 文字超の key は S3 呼び出し前に拒否されます。`indexes/posts.json` のような nested path は許可されます。戻り値は書き込まれた object の public URL です。

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

---

## 14. 質問先

- アーキテクチャ / 設計の質問 → [`docs/architecture/08-plugin-architecture.ja.md`](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.ja.md)
- ファーストパーティプラグインの bug → `heavymoons/ampless` にプラグインの package 名つきで issue
- プラグインランタイム / admin form の bug → 同じレポ、ラベル `area:plugins`

ampless レポは v1.0 RC まで非公開なので、上記のリンクは現時点では package tarball 内の `node_modules/ampless/docs/` をローカルで見るための参照です。public 化後は実 GitHub URL に解決されます。
