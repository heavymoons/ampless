> English: [README.md](./README.md)
> 

# @ampless/plugin-rss

[ampless](https://github.com/heavymoons/ampless) 向け RSS 2.0 フィードプラグイン。

> **プレリリース / アルファ版。** v1.0 まではマイナーバージョンでも破壊的変更が入る可能性があります。

投稿が公開・非公開・更新・削除されるたびに `feed.xml` を S3 に再生成します。Next.js の `/feed.xml` ルートが最新バージョンを配信します。

## インストール

```bash
npm install @ampless/plugin-rss@alpha
```

## 設定

`cms.config.ts` に記述します：

```ts
import { defineConfig } from 'ampless'
import rssPlugin from '@ampless/plugin-rss'

export default defineConfig({
  // ...
  plugins: [
    rssPlugin({
      limit: 20,        // 最新の投稿数
      language: 'ja',   // BCP 47 言語タグ
      // siteUrl: 'https://example.com',
      // feedPath: '/feed.xml',
    }),
  ],
})
```

| オプション | デフォルト | 備考 |
|---|---|---|
| `limit` | `20` | フィードに含める最新公開投稿数 |
| `language` | `'en'` | RSS `<language>` タグ（BCP 47） |
| `siteUrl` | `site.url` | ベース URL のオーバーライド（ステージング環境など） |
| `feedPath` | `/feed.xml` | フィードを配信するパス。`<atom:link rel="self">` 要素に出力されます |

このプラグインは `siteMetadata` フックを通じてサイトの `<head>` に自動検出用の `<link rel="alternate" type="application/rss+xml">` も追加します。

## トラストレベル

`trusted` — 投稿テーブルへの読み取りアクセスと、サイトの S3 バケット内 `public/plugins/rss/` への書き込みアクセスを持つ、trusted Lambda プロセッサーで実行されます。

## フック

以下のイベントを購読します：

- `content.published`
- `content.unpublished`
- `content.deleted`
- `content.updated`（公開済み投稿のタイトル変更時にフィードの `<title>` を更新するため）

各フック呼び出しで公開済み投稿の全セットを再取得し、再生成した XML を `s3://<site-bucket>/public/plugins/rss/feed.xml` に書き込みます。Next.js ルートがそこから読み取るため、フィードは常に最大 1 イベント分だけリアルタイムより遅れます。
