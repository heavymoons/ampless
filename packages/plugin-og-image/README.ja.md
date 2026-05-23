> English: [README.md](./README.md)
> 

# @ampless/plugin-og-image

[ampless](https://github.com/heavymoons/ampless) 向け動的 Open Graph 画像生成プラグイン。SNS クローラーが `https://<your-site>/og/<slug>` にアクセスすると、Next.js ルートが投稿タイトル・抜粋・サイト名・オプション画像（テーマバナーまたは投稿本文の最初の画像）を含む JSX カードをレンダリングし、Next.js `ImageResponse` が PNG を返します。WebP / AVIF ソース画像は [@jsquash](https://github.com/jamsinclair/jSquash) で PNG にデコードされるため、Satori が描画できます。

> **プレリリース / アルファ版。** v1.0 まではマイナーバージョンでも破壊的変更が入る可能性があります。

## インストール

```bash
npm install @ampless/plugin-og-image@alpha
```

## 設定

`cms.config.ts` に記述します：

```ts
import { defineConfig } from 'ampless'
import ogImagePlugin, { loadFontFromUrl } from '@ampless/plugin-og-image'

export default defineConfig({
  // ...
  plugins: [
    ogImagePlugin({
      // 必須: フォントを少なくとも 1 つ指定。Satori はフォントなしではレンダリングできません。
      fonts: [
        {
          name: 'Inter',
          // 遅延ローダー — ルート呼び出しごとに一度実行され、その後はプロセス内キャッシュ。
          // .ttf / .otf を CDN または public/ から配信してください。
          data: loadFontFromUrl('https://example.com/fonts/Inter-Regular.ttf'),
          weight: 400,
        },
      ],
      // 画像ストラテジー: 'content'（投稿本文の最初の画像）| 'theme'
      // （themeImageUrl を使用）| 'none' | (post) => url | null
      image: 'content',
      // image === 'theme' のときに使用
      // themeImageUrl: 'https://example.com/og-banner.png',
    }),
  ],
})
```

Next.js アプリにディスパッチャールートを追加してください（`_shared` テンプレートには `app/og/[slug]/route.ts` が含まれています）。

## オプション

| オプション | デフォルト | 備考 |
|---|---|---|
| `fonts` | 必須 | フォントを少なくとも 1 つ指定 |
| `size` | `{ width: 1200, height: 630 }` | OG カードのサイズ |
| `image` | `'content'` | `'theme'` / `'content'` / `'none'` / `(post) => url \| null` |
| `themeImageUrl` | なし | `image === 'theme'` のときに使用 |
| `render` | 組み込みカード | JSX を完全にカスタマイズする場合にオーバーライド |

## 生成されるもの

- `metadata()` フック — 各投稿のメタデータに `openGraph.images: [{ url: '<site>/og/<slug>', width, height }]` を注入するため、SNS クローラーがカードを取得する場所を認識します。
- `ogImage.render(ctx)` — ディスパッチャールートが `next/og` 経由で PNG に変換します。

## トラストレベル

`untrusted` — Next.js リクエストパスでのみ実行します（Lambda フックなし）。AWS 認証情報は一切使用しません。フォントと投稿画像は通常の HTTPS で取得します。

## ライセンス

[MIT](../../LICENSE)
