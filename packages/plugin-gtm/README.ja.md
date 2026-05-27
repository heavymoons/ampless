> English: [README.md](./README.md)
>

# @ampless/plugin-gtm

[ampless](https://github.com/heavymoons/ampless) 向け Google Tag Manager プラグイン。

> **プレリリース / アルファ版。** v1.0 まではマイナーバージョンでも破壊的変更が入る可能性があります。

descriptor ベースのプラグイン head/body 注入 API を使って、公開ページに GTM 標準の 2 つのスニペットを挿入します。

1. `<head>` 内に async ローダーのインライン `<script>`
2. `<body>` 末尾に対応する `<noscript>` iframe（JavaScript 無効の訪問者でも GTM 経由でページビューを登録できる）

コンテナ ID はデプロイ後 **`/admin/plugins` から編集可能** で、`cms.config.ts` の constructor 引数は初期デフォルトのシードに過ぎません。AWS のデータ権限は不要で、`trust_level` は `untrusted`、公開 Next.js プロセス内で描画時に動きます。

## インストール

```bash
npm install @ampless/plugin-gtm@alpha
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
