> English: [README.md](./README.md)
> 

# @ampless/runtime

[ampless](https://github.com/heavymoons/ampless) 向けパブリックサイドランタイム。投稿取得クライアント、サイト設定、テーマ解決、SEO メタデータ集約、ミドルウェア、パブリックルートハンドラーを `createAmpless()` ひとつのファクトリーにまとめます。

> **プレリリース / アルファ版。** v1.0 まではマイナーバージョンでも破壊的変更が入る可能性があります。

テンプレートから切り出すことで、スキャフォールドされたファイルに触れずに `npm update @ampless/runtime` でアップデートできます — パブリックサイトの動作改善はスキャフォールダーの再実行ではなく、パッケージを通じて届きます。

## インストール

```bash
npm install @ampless/runtime@alpha ampless@alpha
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

`app/site/[siteId]/` 以下のルートとディスパッチャーはワンライナーのファクトリー呼び出しになります：

```ts
// app/site/[siteId]/page.tsx
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
// app/site/[siteId]/og/[slug]/route.ts
import { ampless } from '@/lib/ampless'
import { createOgRouteHandler } from '@ampless/runtime/routes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const GET = createOgRouteHandler(ampless)
```

ミドルウェア：

```ts
// middleware.ts
import cmsConfig from './cms.config'
import { createAmplessMiddleware, defaultMatcherConfig } from '@ampless/runtime/middleware'

export const middleware = createAmplessMiddleware({ cmsConfig })
export const config = defaultMatcherConfig
```

## サブパス

- `@ampless/runtime` — `createAmpless`、ランタイム型、`renderBody`・`renderThemeCss`・フォーマットコンバーターの再エクスポート
- `@ampless/runtime/middleware` — `createAmplessMiddleware`、`defaultMatcherConfig`
- `@ampless/runtime/routes` — `createOgRouteHandler`、`createSitemapRouteHandler`、`createFeedRouteHandler`、`createRawRouteHandler`
- `@ampless/runtime/dispatchers` — `createThemeHomeDispatcher`、`createThemePostDispatcher`、`createThemeTagDispatcher`（それぞれ対応する `*Metadata` ファクトリーあり）

## テンプレートに残るもの

管理側モジュール（投稿プロバイダー、テーマアクション、認証、KV 書き込み）とテーマコンポーネントはスキャフォールドに残ります。これらは後のリリースで `@ampless/admin` に移行する予定です。それまでは、これらのファイルへの変更はユーザーのプロジェクト内で行ってください。

## ライセンス

MIT
