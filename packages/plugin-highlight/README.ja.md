> English: [README.md](./README.md)

# @ampless/plugin-highlight

[ampless](https://github.com/heavymoons/ampless) 向けシンタックスハイライトプラグイン。CDN から遅延ロードした [highlight.js](https://highlightjs.org/) で、公開サイト上のコードブロックをハイライトします。

> **プレリリース / ベータ版。** v1.0 まではマイナーバージョンでも破壊的変更が入る可能性があります。

`publicHead` capability 経由でインラインスクリプトを 1 本だけ `<head>` に注入します。公開ページ側でスクリプトが `<pre><code class="language-xxx">`（`language-mermaid` は除外）を走査し、**1 つでも存在する場合のみ** テーマ用スタイルシートを注入したうえで jsDelivr から highlight.js を動的 import して各ブロックをハイライトします。コードブロックの無いページではライブラリもスタイルシートも一切ダウンロードしません。

AWS のデータ権限は不要です。ディスクリプタの生成は公開 Next.js プロセスのリクエスト時に行われ、ハイライトはブラウザ上で行われます。`trust_level` は `untrusted`。

## インストール

```bash
pnpm add @ampless/plugin-highlight@beta
```

## 設定

`cms.config.ts` に記述します:

```ts
import { defineConfig } from 'ampless'
import highlightPlugin from '@ampless/plugin-highlight'

export default defineConfig({
  // ...
  plugins: [highlightPlugin()],
})
```

## オプション

```ts
highlightPlugin({
  version: '11.11.1', // 既定値（固定 x.y.z）
  theme: 'auto', // 'auto' または highlight.js のスタイルシート名
})
```

| オプション | デフォルト  | 備考                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`  | `'11.11.1'` | jsDelivr から読み込む highlight.js のバージョン。`x` / `x.y` / `x.y.z` に一致する必要あり。不正値は `console.warn` してデフォルトにフォールバック。                                                                                                                                                                                                                                                                                                                    |
| `theme`    | `'auto'`    | `'auto'`（既定）はサイトのカラースキームに追従します（[カラースキーム](#カラースキーム)参照）。または highlight.js のスタイルシート名（例: `github` / `github-dark` / `atom-one-dark` / `monokai`）。明示名は `/^[a-z0-9][a-z0-9-]{0,40}$/` に一致する必要あり。それ以外は `'auto'` にフォールバック。対応する `styles/<theme>.min.css` を CDN から読み込みます。[highlight.js のスタイル一覧](https://github.com/highlightjs/highlight.js/tree/main/src/styles)参照。 |

## カラースキーム

既定の `theme: 'auto'` では、スタイルシートがサイトのライト/ダークのカラースキームに追従するため、ダーク背景でもハイライト済みコードが読みやすく保たれます:

| サイトのスキーム | 使用する highlight.js スタイルシート |
| ---------------- | ------------------------------------ |
| light            | `github`                             |
| dark             | `github-dark`                        |

スキームは実行時に次の順で判定します:

1. `<html data-color-scheme>` 属性 — サイトがスキームを固定する場合（サイト内トグル含む）に ampless が `'light'` / `'dark'` を設定します。
2. 属性が無い場合（サイト設定 `auto`）は OS の `prefers-color-scheme` を使用します（ガード付き。`matchMedia` 未定義環境では light 扱い）。

**ライブ切替。** スキームが変わるとテーマ用スタイルシートがその場で差し替わります — サイト内トグルが `data-color-scheme` を切り替えたとき、および（`auto` モードで属性がスキームを固定していないとき）OS の設定が変わったときの両方に追従します。highlight.js はブロックに `hljs` クラスを残すため、差し替えは `<link>` だけで済みます（再ハイライト不要）。差し替えはちらつきなし（新スタイルシートをロードしてから旧 link を削除）で、連続切替時も最終スキームへ収束します。コードブロックの無いページではスキーム変更時もスタイルシートを読み込みません。

**固定。** 明示テーマ（例: `theme: 'github-dark'`）を渡すと、サイトのスキームに関わらずそのスタイルシートに固定され、ライブ切替も無効になります。

## コードブロックの検出方法

描画後の投稿 HTML から `<pre><code class="language-xxx">` を探し、`language-mermaid` は除外します。ampless のツールバーにあるコードブロック単位の **言語エディタ**が `language-*` クラスを付与し、どの本文フォーマットでも同じ形に着地します:

| `post.format` | クラスの付き方                                                            |
| ------------- | ------------------------------------------------------------------------- |
| `tiptap`      | コードブロックノードの `language` 属性 → 描画時に `class="language-ts"`。 |
| `markdown`    | フェンスドブロック ` ```ts ` → `class="language-ts"`。                    |
| `html`        | 記述された `<pre><code class="language-ts">` はそのまま保持。             |

ハイライトしたい言語をフェンスドブロックに指定します:

````markdown
```ts
const greet = (name: string) => `Hello, ${name}!`
```
````

`language-*` クラスの無いブロック（言語指定なしの素の ` ``` ` フェンス）はそのまま残します。

## @ampless/plugin-mermaid との共存

両プラグインは順序非依存で同時に動作するよう設計されています。本プラグインのセレクタは `code.language-mermaid` を明示的に除外（`:not(.language-mermaid)`）するため、Mermaid の図ソースがシンタックスハイライトされることはありません。`@ampless/plugin-mermaid` はそれらの `<pre>` を描画済み SVG に置換します。ハイライト済みブロックは `:not(.hljs)` で守られるため、二重ハイライトされません。

## クライアント側の堅牢性

- **冪等な再スキャン** — highlight.js は処理済みブロックに `hljs` クラスを付与し、セレクタは `:not(.hljs)` で守るため、再ハイライトしません。
- **SPA / App Router 遷移** — head スクリプトは一度だけ実行されますが、`document.body` に張ったデバウンス付き `MutationObserver` が、クライアント遷移で後から挿入された投稿コンテンツを再スキャンします。
- **ライブなスキーム切替** — `<html>`（`data-color-scheme`）への `MutationObserver` と、`auto` モード時の `matchMedia('(prefers-color-scheme: dark)')` リスナが、スキーム変更時にスタイルシートを差し替えます。差し替えは直列化（同時に 1 本の `<link>` のみ）かつちらつきなしで、コードブロックの無いページでは no-op です。
- **失敗時の復旧** — 動的 import が失敗した場合はキャッシュした import Promise を破棄するため次回スキャンで再試行されます。失敗は握り潰さず `console.warn` で報告します。スタイルシートのロードに失敗した場合は直前のテーマを維持します。
- **テーマ用スタイルシート** — ハイライト対象のブロックがある場合のみ、id `ampless-hljs-theme` で一度だけ注入されます。

## セキュリティ / CDN に関する注意

- **既定バージョンは固定。** 供給網の攻撃面を最小化するため `version` の既定値は厳密な `x.y.z` です。floating な major/minor タグ（例: `'11'`）も指定できますが、その供給網リスクは利用者の責任です。
- **動的 `import()` には SRI（Subresource Integrity）が効きません。** ライブラリは実行時に jsDelivr から取得され、integrity 固定はできません。ライブラリ / スタイルシートの自前ホスティングは将来のオプションとして検討します。
- highlight.js はコードブロックのテキスト内容を読み取って再マークアップするだけで、ハイライト対象のソースを実行することはありません。

## v1 で対応しないこと

- **ビルド時 / サーバサイドハイライトは非対応** — ハイライトはブラウザで行われるため、JS 無効クライアントや初回描画時には未スタイル（ただし可読）のコードが見えます。
- **ラベル無しブロックの言語自動判定は行いません** — `language-*` クラスのあるブロックのみハイライトします。
