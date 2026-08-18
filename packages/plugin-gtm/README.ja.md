> English: [README.md](./README.md)
>

# @ampless/plugin-gtm

[ampless](https://github.com/heavymoons/ampless) 向け Google Tag Manager プラグイン。

> **プレリリース / ベータ版。** v1.0 まではマイナーバージョンでも破壊的変更が入る可能性があります。

descriptor ベースのプラグイン head/body 注入 API を使って、公開ページに GTM 標準の 2 つのスニペットを挿入します。

1. `<head>` 内に async ローダーのインライン `<script>`
2. `<body>` 末尾に対応する `<noscript>` iframe（JavaScript 無効の訪問者でも GTM 経由でページビューを登録できる）

コンテナ ID はデプロイ後 **`/admin/plugins` から編集可能** で、`cms.config.ts` の constructor 引数は初期デフォルトのシードに過ぎません。AWS のデータ権限は不要で、`trust_level` は `untrusted`、公開 Next.js プロセス内で描画時に動きます。

## インストール

```bash
npm install @ampless/plugin-gtm@beta
```

## 設定

`cms.config.ts` に記述します:

```ts
import { defineConfig } from 'ampless'
import gtmPlugin from '@ampless/plugin-gtm'

export default defineConfig({
  // ...
  plugins: [
    gtmPlugin({
      // 初期コンテナ ID。デプロイ後は /admin/plugins から編集可能。
      // 空にしておけば無効化したまま ship できる。
      containerId: '',
    }),
  ],
})
```

| オプション | デフォルト | 備考 |
|---|---|---|
| `containerId` | `''` | 初期 GTM コンテナ ID。例: `GTM-XXXXXXX`。マニフェストの default を seed するだけで、ライブ値はリクエスト時に `/admin/plugins` から読み出される。空文字でプラグインを無効化したまま ship できる。 |
| `instanceId` | `'gtm'` | script / noscript 要素 id と設定保存キーの namespace。同サイトに複数の GTM コンテナを入れる場合に分ける。 |
| `consentCategory` | `''` | オプションの同意カテゴリ slug。設定すると `window.amplessConsent.has(<この値>)` が true になるまで GTM loader を発火しない。gated mode では `<noscript>` fallback は出力されない。詳細は[同意ゲーティング](#同意ゲーティング)を参照。 |

## 同意ゲーティング

デフォルトでは GTM loader は訪問者の同意有無にかかわらずページロードごとに発火します。同意を付与するまで発火を遅延させるには、`consentCategory` に同意カテゴリ slug を設定し、同じ `cms.config.ts` に `@ampless/plugin-cookie-consent` を登録します:

```ts
import { defineConfig } from 'ampless'
import cookieConsent from '@ampless/plugin-cookie-consent'
import gtmPlugin from '@ampless/plugin-gtm'

export default defineConfig({
  plugins: [
    // cookie-consent は GTM plugin より前に置く
    cookieConsent({
      categories: [{ id: 'analytics', label: 'アナリティクス', defaultEnabled: false }],
    }),
    gtmPlugin({
      containerId: 'GTM-XXXXXXX',
      consentCategory: 'analytics',
    }),
  ],
})
```

`consentCategory` を設定すると plugin は **gated mode** に切り替わります: 標準のインライン loader script の代わりに単一のインライン script を emit し、以下の動作をします:

1. 直ちに `window.amplessConsent.has('analytics')` を確認（`localStorage` から復元した同意に対応）。
2. false なら `window.amplessConsent.on('analytics', ...)` で同意イベントを購読して待機。
3. GTM plugin が cookie-consent plugin より先にロードされたケースに備え、`ampless:consent-ready` イベントも購読。

**gated mode では `<noscript>` fallback を出力しません。** `consentCategory` が設定されている場合、通常 `publicBodyEnd` から出力される GTM の fallback iframe は省略されます。理由: JavaScript を無効にした環境では同意バナーを動かせないため、ゲーティング自体が不能です。fallback を抑制することでトラッキングを出さないのが正しいトレードオフです。これは意図した仕様変更であり、必要に応じてサイトのプライバシーポリシーに記載してください。

**Fail-closed 契約:** `consentCategory` を設定したまま `@ampless/plugin-cookie-consent` を登録しなかった場合、`window.amplessConsent` は install されません。GTM は**永久に発火しない**まま 5 秒後に `console.warn` が出力されます:

```
[ampless:gtm] consentCategory is set but window.amplessConsent never installed.
Did you forget to register @ampless/plugin-cookie-consent?
```

この warning は本番環境でも発火します。設定ミスを早期に検出するためのものであり、抑制する仕組みはありません。

**プラグインの順序:** `plugins` 配列内で `@ampless/plugin-cookie-consent` を GTM plugin より前に置いてください。

Consent Convention および `window.amplessConsent` API の詳細は [architecture-08-plugin-architecture](https://github.com/heavymoons/ampless/wiki/architecture-08-plugin-architecture) を参照してください。

## 管理画面からコンテナ ID を編集する

デプロイ後、コンテナ ID は `/admin/plugins` → **Google Tag Manager** で編集できます。空文字保存で `cms.config.ts` から削除せずに無効化、`GTM-XXXXXXX` を保存すれば有効化されます。変更内容は site-settings の S3 ミラーが反映された後（数秒）に公開サイトに反映されます。admin form は cache invalidation を少し遅延発火するので、processor の rebuild 完了前に公開側が古い snapshot を fetch する race を避けています。

## コンテナ ID の取得

1. [Google Tag Manager](https://tagmanager.google.com/) にサインインし、対象サイトのワークスペースを選択。
2. 画面右上にコンテナ ID（`GTM-XXXXXXX` の形式）が表示されます。
3. それを上の `containerId` に設定するか、管理画面のフォームに貼り付けます。

`GTM-XXXXXXX` はコンテナ識別子であって書き込み認証には使われないため、ソースコードにコミットして問題ありません。

### ID パターンについて

admin form はコンテナ ID を `^$|^GTM-[A-Z0-9]+$` でバリデートします（空、または「`GTM-` で始まりその後英数字」の実用形）。Google の [公式インストールドキュメント](https://support.google.com/tagmanager/answer/14847097) は厳密フォーマットを明文化していないため、これは意図的に緩い sanity check です。Google が今後より広い文字集合を使い始めたら issue を立ててください、パターンを広げます。

## 複数インスタンス

各 `gtmPlugin(...)` 呼び出しは描画 DOM と admin 設定保存の両方で独立した `instanceId` namespace を持ちます:

```ts
plugins: [
  gtmPlugin({ instanceId: 'marketing', containerId: 'GTM-AAA' }),
  gtmPlugin({ instanceId: 'product',   containerId: 'GTM-BBB' }),
]
```

admin form では各 instance が個別パネルとして表示されます。

## トラストレベル

`untrusted`。プラグインは `@ampless/runtime` が検証・描画する head / body descriptor を返すだけです。DynamoDB、S3、Lambda プロセッサーには一切触れません。

## まだやらないこと

- **CSP nonce 連携** — インラインローダー script は `nonce` 無しで emit されます。ampless サイトに CSP enforcement を入れる段で別 RFP として middleware → SSR → descriptor の通り道を設計します
- **GTM コンテナのインポート** — このプラグインはローダーを注入するだけです。tags / triggers / variables は通常のサイトと同じく GTM の Web UI 内で設定してください
