> English: [README.md](./README.md)
> 

# @ampless/runtime

[ampless](https://github.com/heavymoons/ampless) 向けパブリックサイドランタイム。投稿取得クライアント、サイト設定、テーマ解決、SEO メタデータ集約、ミドルウェア、パブリックルートハンドラーを `createAmpless()` ひとつのファクトリーにまとめます。

> **プレリリース / ベータ版。** v1.0 まではマイナーバージョンでも破壊的変更が入る可能性があります。

テンプレートから切り出すことで、スキャフォールドされたファイルに触れずに `npm update @ampless/runtime` でアップデートできます — パブリックサイトの動作改善はスキャフォールダーの再実行ではなく、パッケージを通じて届きます。

## インストール

```bash
npm install @ampless/runtime@beta ampless@beta
```

`@ampless/runtime` は `next`（15+）、`react`（18/19）、`aws-amplify`（6+）、`@aws-amplify/adapter-nextjs`（1+）をピア依存として宣言します。CLI スキャフォールダーがテンプレートの `package.json` に互換バージョンをピン留めします。

## 使い方

テンプレートは `lib/ampless.ts` に共有インスタンスを 1 つ作成します：

```ts
import outputs from '../amplify_outputs.json'
import cmsConfig from '../cms.config'
import { themes, DEFAULT_THEME } from '../themes-registry'
import { createAmpless } from '@ampless/runtime'

export const ampless = createAmpless({
  outputs,
  cmsConfig,
  themes: { themes, defaultTheme: DEFAULT_THEME },
})
```

`app/` 直下のルートとディスパッチャーはワンライナーのファクトリー呼び出しになります：

```ts
// app/page.tsx
import { ampless } from '@/lib/ampless'
import {
  createThemeHomeDispatcher,
  createThemeHomeMetadata,
} from '@ampless/runtime/dispatchers'

export const dynamic = 'force-dynamic'
export const generateMetadata = createThemeHomeMetadata(ampless)
export default createThemeHomeDispatcher(ampless)
```

```ts
// app/og/[slug]/route.ts
import { ampless } from '@/lib/ampless'
import { createOgRouteHandler } from '@ampless/runtime/routes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const GET = createOgRouteHandler(ampless)
```

ミドルウェア（proxy）：

```ts
// proxy.ts （Next.js 16 で middleware.ts から改名）
import cmsConfig from './cms.config'
import outputs from './amplify_outputs.json'
import { createAmplessMiddleware } from '@ampless/runtime/middleware'

export const proxy = createAmplessMiddleware({
  cmsConfig,
  appsyncUrl: outputs.data.url,
  apiKey: outputs.data.api_key!,
})

// matcher はインライン定義 — Next.js 16 の Turbopack は `export const config`
// が静的オブジェクトリテラルであることを要求します。
export const config = {
  matcher: [
    '/((?!admin|api|login|_next/static|_next/image|favicon\\.ico|amplify_outputs\\.json).*)',
  ],
}
```

middleware はリクエストごとに AppSync から `post.format` /
`post.metadata` / `post.updatedAt` を取得（apiKey 認証）し、slug をキー
にした 200 エントリの LRU（60 秒 TTL、Lambda モジュールスコープ）で
キャッシュした上で、適切な内部ハンドラーにリクエストを書き換えます。

- 通常の投稿 → 書き換えなし、`app/[slug]/page.tsx` で配信
- `metadata.no_layout: true` HTML → `/raw/<slug>`、
  `app/raw/[slug]/route.ts` で配信
- `format: 'static'` → `/static/<slug>(/<path>)`、
  `app/static/[slug]/[[...path]]/route.ts` で配信
- `/<slug>.md`（フォーマット不問） → `/md/<slug>`、
  `app/md/[slug]/route.ts` で配信 — `ampless.postToMarkdown()` による
  Markdown 投影。`cms.config.ai.markdownRoutes: false` で無効化できます。

`/llms.txt` は書き換えを経由せず、`app/llms.txt/route.ts` に直接マウ
ントされます。直近の公開投稿（デフォルト 100 件、
`cms.config.ai.llmsTxt.limit` で設定可能、1..1000 にクランプ）を
`.md` リンクの一覧として返し、サイト全体を 1 ファイルで把握したい AI
エージェント / クローラー向けの索引になります。
`cms.config.ai.llmsTxt: false` で無効化できます。どちらの設定でも
`llms.txt` は予約 slug になります — slug が `llms.txt` の投稿はテーマ
ページに到達できなくなります。

`/api/mcp` は **匿名・読み取り専用の MCP エンドポイント**（POST での
JSON-RPC 2.0）で、`createPublicMcpRouteHandler(ampless)` が生成し
`app/api/mcp/route.ts` にマウントされます。`@ampless/mcp-server/public`
の 4 ツール（`list_posts` / `get_post` / `search_posts` / `list_tags`）を
公開投稿のみに対して提供します — 書き込み不可・draft 不可視。既定は
無効で、`cms.config.ai.publicMcp: true` で有効化します。ルートは open
CORS（匿名・読み取り専用）、64KB のボディ上限、粗い warm-instance 単位
の circuit breaker（1 warm lambda あたり 600 req/min。per-IP rate limit
ではないので、実運用の濫用対策は CloudFront / WAF を併用）を付与します。
ファクトリは `{ POST, OPTIONS }` を返すので、テンプレートは両方を分割
代入します（`export const POST = ...` の一括代入だと CORS preflight が
欠落します）。

また、`post.metadata.cache`（auto / deep / hot）+ `post.updatedAt` +
`cms.config.cache.{cooldownMs, freshTtlSeconds, deepTtlSeconds}` から
`Cache-Control` を算出してレスポンスに付与します。キャッシュ戦略の
契約については `https://github.com/heavymoons/ampless/wiki/CONTENT` を参照してください。

## サブパス

- `@ampless/runtime` — `createAmpless`、ランタイム型、`renderBody`・`renderThemeCss`・フォーマットコンバーターの再エクスポート
- `@ampless/runtime/middleware` — `createAmplessMiddleware`、`defaultMatcherConfig`
- `@ampless/runtime/routes` — `createOgRouteHandler`、`createSitemapRouteHandler`、`createFeedRouteHandler`、`createRawRouteHandler`、`createStaticRouteHandler`、`createMarkdownRouteHandler`、`createLlmsTxtRouteHandler`、`createPublicMcpRouteHandler`
- `@ampless/runtime/dispatchers` — `createThemeHomeDispatcher`、`createThemePostDispatcher`、`createThemeTagDispatcher`（それぞれ対応する `*Metadata` ファクトリーあり）

## テンプレートに残るもの

管理側モジュール（投稿プロバイダー、テーマアクション、認証、KV 書き込み）とテーマコンポーネントはスキャフォールドに残ります。これらは後のリリースで `@ampless/admin` に移行する予定です。それまでは、これらのファイルへの変更はユーザーのプロジェクト内で行ってください。

## ライセンス

MIT
