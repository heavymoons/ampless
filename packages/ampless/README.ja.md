> English: [README.md](./README.md)
> 

# ampless

AWS Amplify 向け CMS コアライブラリ。

> **プレリリース / ベータ版。** v1.0 まではマイナーバージョンでも破壊的変更が入る可能性があります。全文ドキュメントは [ルート README](https://github.com/heavymoons/ampless#readme) を参照してください。

## 概要

`ampless` は [ampless](https://github.com/heavymoons/ampless) CMS を支えるコアライブラリです。以下を公開しています：

- `defineConfig()` — ユーザー向け `cms.config.ts` スキーマ
- `defineSchema()` — コンテンツタイプ定義（フルカスタムコンテンツタイプシステムは将来対応予定）
- `Post` / `Page` / `Media` / `AuthContext` 共有型
- プラグインコントラクト（`definePlugin`、`AmplessPlugin`、フック、`PluginRuntimeContext`、イベント型、`escapeXml` / `formatPublicAssetUrl`）
- DI スタイルの `setPostsProvider()` — テンプレートの Amplify データラッパーが注入します。未設定の場合は API がダミーの投稿を返すため、AWS を接続する前にプロトタイプを作成できます。

通常は `ampless` に直接依存する必要はありません — `create-ampless` のブログテンプレートや `@ampless/plugin-*` が依存パッケージとして取り込みます。独自のプラグインやテーマを作成する場合にのみ直接インストールしてください。

## インストール

```bash
npm install ampless@beta
```

## 使い方

```ts
import { defineConfig } from 'ampless'

export default defineConfig({
  site: {
    name: 'My Blog',
    url: 'https://example.com',
  },
  plugins: [],
})
```

## 動作要件

- Node.js >= 22
- AWS Amplify Gen 2

## ライセンス

[MIT](../../LICENSE)
