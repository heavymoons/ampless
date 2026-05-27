> English: [README.md](./README.md)
>

# @ampless/plugin-analytics-ga4

[ampless](https://github.com/heavymoons/ampless) 向け Google Analytics 4 プラグイン。

> **プレリリース / アルファ版。** v1.0 まではマイナーバージョンでも破壊的変更が入る可能性があります。

descriptor ベースのプラグイン head 注入 API ([docs/tmp/plugin-extension-spec.md](https://github.com/heavymoons/ampless/blob/main/docs/tmp/plugin-extension-spec.md)、Phase 1) を使って、公開ページの `<head>` に GA4 標準の 2 つのスニペットを挿入します。

1. 非同期 `gtag.js` ローダー (`https://www.googletagmanager.com/gtag/js?id=...`)
2. インライン `gtag('config', '<measurementId>')` のブートストラップ

公開 Next.js プロセス内で描画時に動くだけなので、AWS のデータ権限は不要です。`trust_level` は `untrusted`。

## インストール

```bash
npm install @ampless/plugin-analytics-ga4@alpha
```

## 設定

`cms.config.ts` に記述します:

```ts
import { defineConfig } from 'ampless'
import analyticsGa4Plugin from '@ampless/plugin-analytics-ga4'

export default defineConfig({
  // ...
  plugins: [
    analyticsGa4Plugin({ measurementId: 'G-XXXXXXXX' }),
  ],
})
```

| オプション | デフォルト | 備考 |
|---|---|---|
| `measurementId` | 必須 | GA4 の計測 ID。例: `G-XXXXXXXX`。空文字 `''` を渡すとプラグインを残したまま注入だけ無効化できる。 |
| `instanceId` | `'analytics-ga4'` | 生成される `<script>` 要素 id の namespace。同じサイトに複数の GA4 プロパティを入れる場合に分ける。 |

## measurement ID の取得

1. [Google Analytics](https://analytics.google.com/) にサインインし、対象プロパティを選択。
2. **管理 → データストリーム → ウェブ** を開き、このサイト用ストリームを選択。
3. 画面に `測定 ID`（`G-XXXXXXXX` の形式）が表示されるので、それを上の `measurementId` に設定。

`G-XXXXXXXX` はプロパティ識別子であって書き込み認証には使われないため、ソースコードにコミットして問題ありません。

## 複数インスタンス

Phase 1 では複数インスタンス対応の型定義のみ追加しており、ランタイム検証は Phase 3 で正式化します ([docs/tmp/plugin-extension-roadmap.md](https://github.com/heavymoons/ampless/blob/main/docs/tmp/plugin-extension-roadmap.md))。型としては今でも次のように書けます:

```ts
plugins: [
  analyticsGa4Plugin({ instanceId: 'marketing', measurementId: 'G-AAA' }),
  analyticsGa4Plugin({ instanceId: 'product',   measurementId: 'G-BBB' }),
]
```

## トラストレベル

`untrusted`。プラグインは `@ampless/runtime` が検証・描画する head descriptor を返すだけです。DynamoDB、S3、Lambda プロセッサーには一切触れません。

## まだやらないこと

- **CSP nonce 連携** — Phase 1 ではインライン script に `nonce` を付与しません。ampless サイトに CSP enforcement を入れる段で別途 RFP として middleware → SSR → descriptor の通り道を設計します。
- **管理画面からの設定** — Phase 1 では `cms.config.ts` 直書きのみ。admin 管理は Phase 2。
- **ページ単位のイベント送信** — カスタムイベントはページコード側で `window.gtag('event', ...)` を呼んでください。
