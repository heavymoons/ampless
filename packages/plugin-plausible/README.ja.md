> English: [README.md](./README.md)
>

# @ampless/plugin-plausible

[ampless](https://github.com/heavymoons/ampless) 向け [Plausible Analytics](https://plausible.io/) プラグイン。

> **プレリリース / アルファ版。** v1.0 まではマイナーバージョンでも破壊的変更が入る可能性があります。

descriptor ベースのプラグイン head 注入 API を使って、公開ページに Plausible 標準の `<script>` スニペットを挿入します。Plausible はプライバシー重視・cookie 不使用の解析サービスで、多くの導入で cookie 同意バナーは不要です。

サイトドメインとスクリプト URL はどちらもデプロイ後 **`/admin/plugins` から編集可能** で、`cms.config.ts` の constructor 引数は初期デフォルトのシードに過ぎません。AWS のデータ権限は不要で、`trust_level` は `untrusted`、公開 Next.js プロセス内で描画時に動きます。

## インストール

```bash
npm install @ampless/plugin-plausible@alpha
```

## 設定

`cms.config.ts` に記述します:

```ts
import { defineConfig } from 'ampless'
import plausiblePlugin from '@ampless/plugin-plausible'

export default defineConfig({
  // ...
  plugins: [
    plausiblePlugin({
      // 初期サイトドメイン（Plausible 管理画面に登録した値と一致させる）。
      // デプロイ後は /admin/plugins から編集可能。
      // 空文字でプラグインを無効化したまま ship できる。
      domain: '',
    }),
  ],
})
```

| オプション | デフォルト | 備考 |
|---|---|---|
| `domain` | `''` | 初期 Plausible サイトドメイン。例: `example.com`。Plausible 管理画面に登録した値と完全一致させる必要がある — ミスマッチだとページビューが silently drop される。空文字でプラグインを無効化したまま ship できる。 |
| `scriptUrl` | `'https://plausible.io/js/script.js'` | Plausible スクリプトの URL。self-hosted Plausible を使う場合に上書き（例: `'https://analytics.example.com/js/script.js'`）。admin field は **required** なので値を消すことはできない。plausible.io デフォルトに戻すには admin form の **デフォルトに戻す** を使う。 |
| `instanceId` | `'plausible'` | script 要素 id と設定保存キーの namespace。同サイトに複数の Plausible site を入れる場合に分ける。 |
| `consentCategory` | `''` | オプションの同意カテゴリ slug。設定すると `window.amplessConsent.has(<この値>)` が true になるまで Plausible loader を発火しない。詳細は[同意ゲーティング](#同意ゲーティング)を参照。 |

## 同意ゲーティング

Plausible はプライバシー重視・cookie 不使用の解析サービスであり、多くの導入では同意ゲーティングは不要です。ただし、サイトの法的要件やプライバシーポリシーで解析スクリプト読み込み前の明示的同意が必要な場合は gated mode を有効にできます:

```ts
import { defineConfig } from 'ampless'
import cookieConsent from '@ampless/plugin-cookie-consent'
import plausiblePlugin from '@ampless/plugin-plausible'

export default defineConfig({
  plugins: [
    // cookie-consent は Plausible plugin より前に置く
    cookieConsent({
      categories: [{ id: 'analytics', label: 'アナリティクス', defaultEnabled: false }],
    }),
    plausiblePlugin({
      domain: 'example.com',
      consentCategory: 'analytics',
    }),
  ],
})
```

`consentCategory` を設定すると plugin は **gated mode** に切り替わります: 標準の `<script>` descriptor の代わりに単一のインライン script を emit し、以下の動作をします:

1. 直ちに `window.amplessConsent.has('analytics')` を確認（`localStorage` から復元した同意に対応）。
2. false なら `window.amplessConsent.on('analytics', ...)` で同意イベントを購読して待機。
3. Plausible plugin が cookie-consent plugin より先にロードされたケースに備え、`ampless:consent-ready` イベントも購読。

**Fail-closed 契約:** `consentCategory` を設定したまま `@ampless/plugin-cookie-consent` を登録しなかった場合、`window.amplessConsent` は install されません。Plausible は**永久に発火しない**まま 5 秒後に `console.warn` が出力されます:

```
[ampless:plausible] consentCategory is set but window.amplessConsent never installed.
Did you forget to register @ampless/plugin-cookie-consent?
```

この warning は本番環境でも発火します。設定ミスを早期に検出するためのものであり、抑制する仕組みはありません。

**プラグインの順序:** `plugins` 配列内で `@ampless/plugin-cookie-consent` を Plausible plugin より前に置いてください。

Consent Convention および `window.amplessConsent` API の詳細は [docs/architecture/08-plugin-architecture.md](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.md) を参照してください。

## 管理画面から設定を編集する

デプロイ後、両 field は `/admin/plugins` → **Plausible Analytics** で編集できます。

- **サイトドメイン** — 空文字保存で `cms.config.ts` から削除せずに無効化、`example.com` を保存すれば有効化されます
- **スクリプト URL** — 必須、デフォルトは `https://plausible.io/js/script.js`。self-hosted Plausible に向けたいときに上書き。`required: true` なので値を消すことはできず、plausible.io デフォルトに戻すには admin form の **デフォルトに戻す** を使ってください

変更内容は site-settings の S3 ミラーが反映された後（数秒）に公開サイトに反映されます。

## Plausible にドメインを登録する

1. [Plausible ダッシュボード](https://plausible.io/sites)（または self-hosted Plausible インスタンス）にサインインします。
2. **Add site** で、ここで設定するのと同じドメインを入力します — 例: `example.com`。Plausible は受信イベントを「登録済みドメイン文字列」で照合するので、admin form の値とダッシュボードの値は文字単位で一致させる必要があります。
3. ドメインを上の `domain` に設定するか、admin form に貼り付けます。

ドメイン文字列はサイト識別子であって書き込み認証には使われないため、ソースコードにコミットして問題ありません。

## self-hosted Plausible

[Plausible Community Edition](https://github.com/plausible/community-edition) は自前インフラ上にホストできる self-hosted 版です。このプラグインから self-hosted インスタンスを使うには、admin form（または初期 default として `cms.config.ts`）で `scriptUrl` を上書きします:

```ts
plausiblePlugin({
  domain: 'example.com',
  scriptUrl: 'https://analytics.example.com/js/script.js',
})
```

plausible.io デフォルトに戻すには admin form の **デフォルトに戻す** をクリックしてください — 保存済み DDB 行が削除され、次のリクエストから manifest default に fallback します。

## 複数インスタンス

各 `plausiblePlugin(...)` 呼び出しは描画 DOM と admin 設定保存の両方で独立した `instanceId` namespace を持ちます:

```ts
plugins: [
  plausiblePlugin({ instanceId: 'marketing', domain: 'marketing.example.com' }),
  plausiblePlugin({ instanceId: 'product',   domain: 'app.example.com' }),
]
```

admin form では各 instance が個別パネルとして表示されます。

## トラストレベル

`untrusted`。プラグインは `@ampless/runtime` が検証・描画する head descriptor を返すだけです。DynamoDB、S3、Lambda プロセッサーには一切触れません。

## まだやらないこと

- **CSP nonce 連携** — script descriptor は `nonce` 無しで emit されます。ampless サイトに CSP enforcement を入れる段で別 RFP として middleware → SSR → descriptor の通り道を設計します
- **Plausible custom event** — ローダーを注入するだけです。custom event はページコード側で標準 Plausible API (`window.plausible(...)`) を呼んでください
