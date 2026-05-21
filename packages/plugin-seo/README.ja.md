> English: [README.md](./README.md)
> 

# @ampless/plugin-seo

[ampless](https://github.com/heavymoons/ampless) 向け SEO プラグイン。投稿ごと・サイトごとのメタデータ（Open Graph、Twitter カード、canonical）を生成し、投稿セットが変更されるたびに `sitemap.xml` を S3 に再生成します。

> **プレリリース / アルファ版。** v1.0 まではマイナーバージョンでも破壊的変更が入る可能性があります。

## インストール

```bash
npm install @ampless/plugin-seo@alpha
```

## 設定

`cms.config.ts` に記述します：

```ts
import { defineConfig } from 'ampless'
import seoPlugin from '@ampless/plugin-seo'

export default defineConfig({
  // ...
  plugins: [
    seoPlugin({
      // defaultOgImage: 'https://example.com/og-default.png',
      // twitterSite: '@example',
      // twitterCreator: '@author',
      // twitterCard: 'summary_large_image',
    }),
  ],
})
```

| オプション | デフォルト | 備考 |
|---|---|---|
| `defaultOgImage` | なし | 設定時、全投稿の `og:image` と `twitter:image` のフォールバックとして使用 |
| `twitterSite` | なし | サイトの `@handle` |
| `twitterCreator` | なし | 投稿著者の `@handle` |
| `twitterCard` | `'summary_large_image'` | カードスタイル |
| `siteUrl` | `site.url` | ベース URL のオーバーライド（ステージング環境など） |
| `priority` / `changefreq` / `limit` | （サイトマップのデフォルト） | サイトマップエントリーの調整 |

## 生成されるもの

- **投稿ごとのメタデータ**（Next.js `generateMetadata` 形式）: `title`、`description`、`alternates.canonical`、`openGraph`（article タイプ、url、images）、`twitter`（カード、ハンドル、images）
- **サイトレベルのメタデータ**: ルートレイアウト用のデフォルト — title、description、og:website
- **`/sitemap.xml`** — 全 URL セット。`content.published` / `content.unpublished` / `content.deleted` / `content.updated` イベントごとに `s3://<bucket>/public/plugins/seo/sitemap.xml` に再生成されます。テンプレートの `/sitemap.xml` ルートハンドラーが配信します。

## トラストレベル

`trusted` — サイトマップの再生成は、投稿テーブルへの読み取りアクセスと、サイトの S3 バケット内 `public/plugins/seo/` への書き込みアクセスを持つ、trusted Lambda プロセッサーで実行されます。メタデータヘルパー（`metadata` / `siteMetadata`）は Next.js の SSR 中に動作する純粋関数であり、AWS へのアクセスは不要です。

## ライセンス

[MIT](../../LICENSE)
