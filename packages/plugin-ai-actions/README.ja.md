> English: [README.md](./README.md)
>

# @ampless/plugin-ai-actions

[ampless](https://github.com/heavymoons/ampless) の投稿ページ向け、人間から AI への導線プラグイン。本文の前後に最大 3 つのリンクを持つ小さな `<p class="ampless-ai-actions">` 要素を挿入します。

> **プレリリース / ベータ版。** v1.0 まではマイナーバージョンでも破壊的変更が入る可能性があります。

リンクは `publicHtmlForPost` capability（Phase 6d）経由で出力されます。`ampless.publicHtmlForPost(post)` を呼ぶテーマなら自動的に描画されます。HTML はランタイムが `sanitize-html` で strict allowlist に沿ってサニタイズするため、テーマ側で `dangerouslySetInnerHTML` を使う必要はありません。

AWS のデータ権限は不要です。すべて公開 Next.js プロセスのリクエスト時に動作します。`trust_level` は `untrusted`。

## `ai.markdownRoutes` が前提

**このプラグインが出力する全アクションは投稿の `/<slug>.md` Markdown 投影に依存します** — 2 つの外部 AI リンクも、prompt の `?q=` に絶対 `.md` URL を渡します。`cms.config.ts` で `ai.markdownRoutes: false` を設定しているサイトでは、「View as Markdown」リンクは 404 になり、Claude/ChatGPT リンク自体は開くものの、AI に渡る `.md` URL が存在しないため機能しません。**`ai.markdownRoutes` を無効化したサイトではこのプラグインを登録しないでください** — `ai.markdownRoutes` はデフォルトで有効なのでほとんどのサイトでは意識不要ですが、インストール前に確認してください。

## インストール

```bash
npm install @ampless/plugin-ai-actions@beta
```

## 設定

`cms.config.ts` に記述します:

```ts
import { defineConfig } from 'ampless'
import aiActionsPlugin from '@ampless/plugin-ai-actions'

export default defineConfig({
  // ...
  plugins: [
    aiActionsPlugin(),
  ],
})
```

| オプション | デフォルト | 備考 |
|---|---|---|
| `showMarkdownLink` | `true` | `/<slug>.md` への「Markdown で表示」リンク。 |
| `showClaude` | `false` | 「Claude で開く」リンク。**opt-in** — 下記[外部 AI リンクについて](#外部-ai-リンクopt-in)を参照。 |
| `showChatgpt` | `false` | 「ChatGPT で開く」リンク。**opt-in** — 同上の注意点。 |
| `promptTemplate` | `'Read {url}'` | Claude/ChatGPT の `?q=` prefill に使うプロンプト。`{url}` は絶対 `.md` URL に置換されます。 |
| `position` | `'afterContent'` | `'beforeContent'` または `'afterContent'`。`@ampless/plugin-reading-time` とは逆のデフォルト — 記事を読んでから AI アクションを提示する意図。 |
| `instanceId` | `'ai-actions'` | ランタイムのキー解決に使う namespace。同じサイトで 2 回登録する場合のみ変更する。 |

`instanceId` を除く表示設定はデプロイなしで `/admin/plugins → AI アクション` から編集できます。コンストラクタの値は初期デフォルトに過ぎません。`instanceId` は `settings.public` に含まれないため、`cms.config.ts` でのみ設定できます。

## 外部 AI リンク（opt-in）

`showClaude` と `showChatgpt` はデフォルト **オフ** です。`https://claude.ai/new?q=...` と `https://chatgpt.com/?q=...` の URL prefill パターンは**広く使われているコミュニティ慣習**であり、Anthropic / OpenAI が公式に文書化・バージョン管理している URL 契約ではありません。ログイン状態（ログイン済み / 未ログイン）やプラットフォーム（デスクトップ / モバイル）によって挙動が異なる可能性があり、どちらのベンダーも予告なくこのクエリパラメータを変更・廃止し得ます。

どちらかのリンクを有効化する前に、自サイトで以下を確認してください:

- デスクトップでログイン済みの状態でプロンプトが正しく prefill されるか
- モバイルで正しく prefill されるか（ネイティブアプリとモバイルブラウザで挙動が異なることがある）
- 未ログイン状態でどうなるか

挙動が不安定であれば、リンクをオフのままにしてください — 「Markdown で表示」リンク（デフォルトでオン）だけでも、読者や AI ツールに綺麗な Markdown の入口を提供できます。読者はそれを開いて任意の AI チャットに手動でコピー & ペーストできます。

## 「Copy Markdown」ボタンが無い理由

初期検討では「Copy Markdown」ボタン（`onclick` によるクリップボード書き込み）も候補にありましたが、現行のプラグイン surface では安全に実現できないため実装していません:

- `publicHtmlForPost` の sanitizer はすべてのインラインイベントハンドラ（`onclick` 等）と `<button>` 要素を drop します — サニタイズ仕様は `@ampless/runtime` を参照。
- `publicPostScript`（ページ JS を追加できるもう一つの plugin surface）は外部の絶対 `http(s)` script `src` のみを受け付け、投稿単位のロジックを書けるインラインスクリプトチャネルは現状ありません。

inline-script capability の新設か plugin asset 配信の仕組みが無いと、この descriptor ベースの surface にクリップボード動作を配線する方法がありません。将来 Copy を実現できる capability が入るまでは、「Markdown で表示」+ ブラウザの「全選択 → コピー」が実用上の代替です。

## 出力 HTML

```html
<p class="ampless-ai-actions">
  <a class="ampless-ai-actions-md" href="/my-post.md">View as Markdown</a>
  <span class="ampless-ai-actions-sep"> · </span>
  <a class="ampless-ai-actions-claude" href="https://claude.ai/new?q=Read%20https%3A%2F%2Fexample.com%2Fmy-post.md" target="_blank" rel="noopener noreferrer">Open in Claude</a>
  <span class="ampless-ai-actions-sep"> · </span>
  <a class="ampless-ai-actions-chatgpt" href="https://chatgpt.com/?q=Read%20https%3A%2F%2Fexample.com%2Fmy-post.md" target="_blank" rel="noopener noreferrer">Open in ChatGPT</a>
</p>
```

（読みやすさのために改行・インデントを加えています。実際の出力に要素間の空白はありません。）

- クラス名（`ampless-ai-actions` / `ampless-ai-actions-md` / `ampless-ai-actions-claude` / `ampless-ai-actions-chatgpt` / `ampless-ai-actions-sep`）はテーマ CSS のための安定したフックです。site テンプレートの `globals.css` に控えめな既定スタイル（ピル型リンク）が同梱されます。ゼロ詳細度（`:where()`）なので、テーマ CSS で自由に上書きできます。
- ラベル（"View as Markdown" / "Open in Claude" / "Open in ChatGPT"）は v1 では英語固定です。ロケール対応は要望が出てから検討します。
- 「Markdown で表示」リンクは `site.url` が設定されていても常に**相対パス**（`/<slug>.md`）です — ページがどのドメインで配信されていても機能します。
- Claude/ChatGPT リンクは外部サービスに渡すため**絶対 URL** が必要です。実効 `site.url` が空の場合、有効化していてもこの 2 リンクは省略され、「Markdown で表示」のみ描画されます。
- 外部リンク（`target="_blank"`）には常に `rel="noopener noreferrer"` が付きます。プラグイン側で生成時点で付与しています（ランタイムの sanitizer も同じ属性を注入しますが、生成元で先に付けておくことでプラグイン自身の sanitize round-trip テストが完全一致になります）。

## トラストレベル

`untrusted`。`@ampless/runtime` が検証・サニタイズする HTML descriptor を返すだけです。DynamoDB、S3、Lambda プロセッサーには一切触れません。

## v1 では対応しないこと

- **Copy Markdown（クリップボード）** — 上記[「Copy Markdown」ボタンが無い理由](#copy-markdown-ボタンが無い理由)を参照。
- **MCP 接続情報** — サイトの MCP endpoint を案内するリンク / QR コードは、将来の公開読み取り専用 MCP サーバーの提供後に検討予定です。
- **テーマ固有の CSS** — プラグイン自体はテーマごとのスタイルを持ちません。site テンプレートの `globals.css` にニュートラルな既定スタイル（ピル型リンク）がゼロ詳細度（`:where()`）で同梱されるのみで、それ以上の見た目は安定クラス名を使ったテーマ CSS の担当です。
- **ロケール別ラベル** — 未対応です。リンクテキストは英語固定で、プラグインを複数回登録しても解決になりません（全 instance が同じ position バケットに描画されるため、テーマがロケール別のスロットを選べません）。要望が出た時点で検討します。
