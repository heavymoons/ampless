> English: [README.md](./README.md)
>

# @ampless/plugin-analytics-ga4

[ampless](https://github.com/heavymoons/ampless) 向け Google Analytics 4 プラグイン。

> **プレリリース / ベータ版。** v1.0 までは破壊的変更が入る可能性があります。

descriptor ベースのプラグイン head 注入 API ([plugin architecture](https://github.com/heavymoons/ampless/wiki/architecture-08-plugin-architecture.ja)) を使って、公開ページの `<head>` に GA4 標準の 2 つのスニペットを挿入します。

1. 非同期 `gtag.js` ローダー (`https://www.googletagmanager.com/gtag/js?id=...`)
2. インライン `gtag('config', '<measurementId>')` のブートストラップ

公開 Next.js プロセス内で描画時に動くだけなので、AWS のデータ権限は不要です。`trust_level` は `untrusted`。

## インストール

```bash
npm install @ampless/plugin-analytics-ga4@beta
```

## 設定

`cms.config.ts` に登録し、実際の値は `/admin/plugins` から編集します。constructor の `measurementId` は bootstrap と後方互換用の optional fallback です:

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
| `measurementId` | `''` | Optional fallback の GA4 計測 ID。例: `G-XXXXXXXX`。runtime では admin 管理の値が優先されます。空文字 `''` を渡すとプラグインを残したまま注入だけ無効化できる。 |
| `instanceId` | `'analytics-ga4'` | 生成される `<script>` 要素 id の namespace。同じサイトに複数の GA4 プロパティを入れる場合に分ける。 |
| `consentCategory` | `''` | オプションの同意カテゴリ slug。設定すると `window.amplessConsent.has(<この値>)` が true になるまで GA4 loader を発火しない。詳細は[同意ゲーティング](#同意ゲーティング)を参照。 |

## 同意ゲーティング

デフォルトでは GA4 loader は訪問者の同意有無にかかわらずページロードごとに発火します。訪問者が同意を付与するまで発火を遅延させるには、`consentCategory` に同意カテゴリ slug を設定し、同じ `cms.config.ts` に `@ampless/plugin-cookie-consent` を登録します:

```ts
import { defineConfig } from 'ampless'
import cookieConsent from '@ampless/plugin-cookie-consent'
import analyticsGa4Plugin from '@ampless/plugin-analytics-ga4'

export default defineConfig({
  plugins: [
    // cookie-consent は analytics plugin より前に置く
    cookieConsent({
      categories: [{ id: 'analytics', label: 'アナリティクス', defaultEnabled: false }],
    }),
    analyticsGa4Plugin({
      measurementId: 'G-XXXXXXXX',
      consentCategory: 'analytics',
    }),
  ],
})
```

`consentCategory` を設定すると plugin は **gated mode** に切り替わります: 標準 GA4 の 2 descriptor の代わりに単一のインライン script を emit し、以下の動作をします:

1. 直ちに `window.amplessConsent.has('analytics')` を確認（前回の訪問で同意が付与されて `localStorage` から復元されているケースに対応）。
2. false なら `window.amplessConsent.on('analytics', ...)` で同意イベントを購読して待機。
3. analytics plugin が cookie-consent plugin の API install より先にロードされたケースに備え、`ampless:consent-ready` イベントも購読。

**Fail-closed 契約:** `consentCategory` を設定したまま `@ampless/plugin-cookie-consent` を登録しなかった場合、`window.amplessConsent` は install されません。GA4 は**永久に発火しない**まま 5 秒後に `console.warn` が出力されます:

```
[ampless:analytics-ga4] consentCategory is set but window.amplessConsent never installed.
Did you forget to register @ampless/plugin-cookie-consent?
```

この warning は本番環境でも発火します。設定ミスを早期に検出するためのものであり、抑制する仕組みはありません。

**プラグインの順序:** `plugins` 配列内で `@ampless/plugin-cookie-consent` を analytics plugin より前に置いてください。runtime はプラグインを順番に処理するため、cookie-consent を先に置くことで analytics の gating ロジック実行時に `window.amplessConsent` が確実に install されます。

Consent Convention および `window.amplessConsent` API の詳細は [architecture-08-plugin-architecture](https://github.com/heavymoons/ampless/wiki/architecture-08-plugin-architecture) を参照してください。

## measurement ID の取得

1. [Google Analytics](https://analytics.google.com/) にサインインし、対象プロパティを選択。
2. **管理 → データストリーム → ウェブ** を開き、このサイト用ストリームを選択。
3. 画面に `測定 ID`（`G-XXXXXXXX` の形式）が表示されるので、それを上の `measurementId` に設定。

`G-XXXXXXXX` はプロパティ識別子であって書き込み認証には使われないため、ソースコードにコミットして問題ありません。

## 複数インスタンス

プラグイン契約は `instanceId` を分けた複数インスタンスをサポートします。GA4 プロパティごとに 1 インスタンスを使います:

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
- **ページ単位のイベント送信** — カスタムイベントはページコード側で `window.gtag('event', ...)` を呼んでください。
