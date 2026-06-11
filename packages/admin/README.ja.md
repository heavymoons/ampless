> English: [README.md](./README.md)
> 

# @ampless/admin

[ampless](https://github.com/heavymoons/ampless) 向け管理 UI ライブラリ。投稿エディター（Tiptap + Markdown + HTML）、メディアマネージャー（S3 + 画像処理）、サイト / テーマ設定、ロケール対応 UI 文字列、そしてすべてを結びつける Next.js ページファクトリーを提供します。

> **プレリリース / ベータ版。** v1.0 まではマイナーバージョンでも破壊的変更が入る可能性があります。

## なぜライブラリなのか？

管理 UI を `@ampless/admin` として切り出すことで、プロジェクトは `npm update @ampless/admin` を実行するだけで改善を取り込めます — 他の依存パッケージと同じアップグレードフローで、テンプレートと各サイト間でファイルをコピーし続ける必要はありません。

## インストール

```bash
npm install @ampless/admin@beta @ampless/runtime@beta ampless@beta
```

ピア依存: `next`、`react`、`react-dom`、`aws-amplify`、`@aws-amplify/adapter-nextjs`。

## 接続方法

Next.js プロジェクトに `lib/admin.ts` を作成します：

```ts
import outputs from '../amplify_outputs.json'
import cmsConfig from '../cms.config'
import { createAdmin } from '@ampless/admin'
import { ampless } from './ampless'

export const admin = createAdmin({ outputs, cmsConfig, ampless })
export const t = admin.t
```

各管理ルートを薄いシェルとして公開します：

```tsx
// app/(admin)/admin/posts/page.tsx
import { admin } from '@/lib/admin'
import { createPostsListPage } from '@ampless/admin/pages'
export default createPostsListPage(admin)
```

```ts
// app/api/media/[...path]/route.ts
import { admin } from '@/lib/admin'
import { createMediaProxyRoute } from '@ampless/admin/api'
export const { GET } = createMediaProxyRoute(admin)
export const runtime = 'nodejs'
```

## サブパス

| サブパス                       | 内容                                                 |
| ----------------------------- | --------------------------------------------------- |
| `@ampless/admin`              | `createAdmin` ファクトリー + `Admin` インターフェース  |
| `@ampless/admin/pages`        | ページファクトリー — 管理ルートごとに 1 つ             |
| `@ampless/admin/api`          | API ルートファクトリー（`createMediaProxyRoute` など）|
| `@ampless/admin/components`   | 高度な接続用フォーム / エディターコンポーネント         |

## ロケール

`createAdmin({ locale: 'ja' })` で管理 UI 文字列を日本語に切り替えます。
オブジェクトリテラルを渡すと個別の文字列をオーバーライドできます：

```ts
createAdmin({
  outputs,
  cmsConfig,
  locale: { sidebar: { brand: 'MySite Admin' } },
})
```
