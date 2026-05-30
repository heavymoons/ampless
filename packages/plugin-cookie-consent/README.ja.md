> English: [README.md](./README.md)
>

# @ampless/plugin-cookie-consent

[ampless](https://github.com/heavymoons/ampless) 向け GDPR/ePrivacy 対応 Cookie 同意バナープラグイン。

> **プレリリース / アルファ版。** v1.0 まではマイナーバージョンでも破壊的変更が入る可能性があります。

公開ページの `<head>` に `window.amplessConsent` Consent Convention API（[プラグインアーキテクチャ doc](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.ja.md) §Consent Convention）をインストールし、React ツリー外に設定可能な同意バナーを `<body>` に追加します。analytics / トラッキング系プラグインはこの API を利用して、訪問者が同意するまで自身を無効化します。

AWS のデータ権限は不要です。すべて公開 Next.js プロセスの描画時に動作します。`trust_level` は `untrusted`。

## インストール

```bash
npm install @ampless/plugin-cookie-consent@alpha
```

## 設定

`cms.config.ts` に記述します:

```ts
import { defineConfig } from 'ampless'
import cookieConsentPlugin from '@ampless/plugin-cookie-consent'

export default defineConfig({
  // ...
  plugins: [
    // cookie-consent を最初に登録し、後続の analytics プラグインが
    // window.amplessConsent を参照できるようにする。
    cookieConsentPlugin(),
    // analyticsGa4Plugin({ ... }),  // PR D 以降
  ],
})
```

| オプション | デフォルト | 備考 |
|---|---|---|
| `instanceId` | `'cookie-consent'` | スクリプト要素 id の namespace。同じサイトに複数登録する場合のみ変更する。 |

## 設定項目（管理画面）

`/admin/plugins → Cookie Consent` から設定できます:

| キー | 型 | デフォルト | 備考 |
|---|---|---|---|
| `bannerText` | textarea | `'このサイトは…'` | バナー上部に表示するメッセージ。 |
| `acceptLabel` | text | `'Accept all'` | 「すべて同意」ボタンのラベル。 |
| `rejectLabel` | text | `'Reject non-essential'` | 「拒否」ボタンのラベル。 |
| `position` | select | `'bottom'` | `'bottom'` / `'top'` / `'modal'`。 |
| `categories` | repeatable | `[]` | 同意カテゴリのリスト。 |

### 同意カテゴリ

`categories` repeatable フィールドの各カテゴリは以下のサブフィールドを持ちます:

| サブフィールド | 型 | 必須 | 備考 |
|---|---|---|---|
| `id` | text | yes | 機械可読な識別子。例: `'analytics'`。パターン: `^[a-z][a-z0-9_-]*$`。 |
| `label` | text | yes | バナーのチェックボックス横に表示する名称。 |
| `description` | textarea | no | ラベルの下に表示する短い説明。 |
| `defaultEnabled` | boolean | no | 訪問者が選択する前のチェックボックスの初期状態。 |
| `essential` | boolean | no | 常時 ON（トグル不可）。`defaultEnabled` より優先される。 |

管理画面での設定例 — 2 カテゴリを追加:

```
id: analytics     label: アクセス解析
id: marketing     label: マーケティング・パーソナライズ
```

## Consent Convention

このプラグインは ampless Consent Convention を実装します。インストール後、すべてのページで次の API が使えます:

```js
window.amplessConsent.has('analytics')  // → boolean
window.amplessConsent.on('analytics', function() { /* 同意後に一度だけ発火 */ })  // unsubscribe 関数を返す
window.amplessConsent.set('analytics', true)  // バナー UI が呼ぶ
```

`window` 上で発火する標準イベント:

- `ampless:consent-ready` — API インストールと localStorage restore の直後に 1 度だけ発火。
- `ampless:consent-changed` — `set()` のたびに発火。`detail: { category, granted }`。

同意状態は `localStorage` のキー `'ampless:consent'` に `Record<string, boolean>` の JSON として保存されます。

詳細な API 仕様と analytics 側の consume パターンは [`docs/architecture/08-plugin-architecture.ja.md` — Consent Convention](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.ja.md#consent-convention) を参照してください。

## analytics プラグインとの組み合わせ（PR D 以降）

GA4 / GTM / Plausible プラグインに `consentCategory` サポートが追加された後（Phase 3b PR D）、次のように組み合わせられます:

```ts
plugins: [
  cookieConsentPlugin(),
  analyticsGa4Plugin({ measurementId: 'G-XXXXXXXX', consentCategory: 'analytics' }),
  gtmPlugin({ containerId: 'GTM-XXXXXXX', consentCategory: 'analytics' }),
]
```

`consentCategory` を設定した analytics プラグインは、訪問者が該当カテゴリに同意するまで発火しません。`window.amplessConsent` がインストールされていない場合（`cookieConsentPlugin` が `cms.config.ts` に未登録の場合）、トラッキングは**永久に発火しません** — これは意図した fail-closed 設計です。

> **注意:** GA4 / GTM / Plausible の `consentCategory` 対応は Phase 3b PR D で実装予定（未リリース）です。

## トラストレベル

`untrusted`。`@ampless/runtime` が検証・描画する inline script descriptor を返すだけです。DynamoDB、S3、Lambda プロセッサーには一切触れません。

## v1 では対応しないこと

- **テーマ統合** — バナーのスタイルはライトテーマ固定です。CSS 変数やテーマ API を使ったカスタマイズは、対応する capability surface が整ってから検討します。
- **GPC / DNT シグナルの自動処理** — Global Privacy Control や Do Not Track シグナルは自動的に反映されません。デフォルトの同意状態は運用者が設定してください。
- **管轄区域別のデフォルト** — 訪問者の地域（EU か否か）を自動判定してオプトイン/アウトのデフォルトを切り替える機能はありません。
- **サブカテゴリのネスト** — 各カテゴリはフラットな boolean です。ネストされたサブカテゴリは deferred です。
- **アイテムの並び替え** — 管理画面の `categories` repeatable は追加/削除のみで、v1 ではドラッグによる並び替えはサポートしません。
