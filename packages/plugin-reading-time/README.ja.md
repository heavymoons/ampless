> English: [README.md](./README.md)
>

# @ampless/plugin-reading-time

[ampless](https://github.com/heavymoons/ampless) 向け読了時間バッジプラグイン。投稿本文のテキストから読了時間を推定し、本文の前後に設定可能なラベルを挿入します。

> **プレリリース / アルファ版。** v1.0 まではマイナーバージョンでも破壊的変更が入る可能性があります。

バッジは `publicHtmlForPost` capability（Phase 6d）経由で出力されます。`ampless.publicHtmlForPost(post)` を呼ぶテーマなら自動的に描画されます。HTML はランタイムが `sanitize-html` で strict allowlist に沿ってサニタイズするため、テーマ側で `dangerouslySetInnerHTML` を使う必要はありません。

AWS のデータ権限は不要です。すべて公開 Next.js プロセスのリクエスト時に動作します。`trust_level` は `untrusted`。

## インストール

```bash
npm install @ampless/plugin-reading-time@alpha
```

## 設定

`cms.config.ts` に記述します:

```ts
import { defineConfig } from 'ampless'
import readingTimePlugin from '@ampless/plugin-reading-time'

export default defineConfig({
  // ...
  plugins: [
    readingTimePlugin(),
  ],
})
```

| オプション | デフォルト | 備考 |
|---|---|---|
| `wordsPerMinute` | `200` | 想定読書速度。英語の成人平均は 200〜250 WPM。 |
| `labelTemplate` | `'{minutes} min read'` | ラベルのテンプレート。`{minutes}` と `{words}` プレースホルダーを使用可能。 |
| `position` | `'beforeContent'` | `'beforeContent'` または `'afterContent'`。 |
| `instanceId` | `'reading-time'` | ランタイムのキー解決に使う namespace。同じサイトで 2 回登録する場合のみ変更する。 |

すべてのオプションはデプロイなしで `/admin/plugins → 読了時間` から編集できます。コンストラクタの値は初期デフォルトに過ぎません。

## 設定項目（管理画面）

`/admin/plugins → 読了時間` から設定できます:

| キー | 型 | デフォルト | 備考 |
|---|---|---|---|
| `wordsPerMinute` | number | `200` | 最小 50、最大 1000。読書速度の仮定値。 |
| `labelTemplate` | text | `'{minutes} min read'` | `{minutes}` と `{words}` をプレースホルダーとして使用可能。最大 200 文字。 |
| `position` | select | `'beforeContent'` | `'beforeContent'` / `'afterContent'`。 |

## 出力 HTML

プラグインは単一の `<p>` 要素を出力します:

```html
<p class="ampless-reading-time" data-words="480" data-minutes="3">3 min read</p>
```

- `data-words` — 生の語数（CJK 正規化後）。
- `data-minutes` — 推定読了時間（分）。常に 1 以上。
- クラス名 `ampless-reading-time` は安定しており、CSS によるスタイリングに利用できます。

## 語数カウント

- **英語:** 空白区切りのトークン数。
- **CJK 文字**（漢字・ひらがな・カタカナ）: 独立してカウントし、2 で除算して英語 WPM に合わせた換算値を算出。具体的には `CJK 文字数 / 2` の reading units を英語語数に加算します。
- **複合言語の投稿**: 両方のカウントを合算します。

フォーマット別テキスト抽出:

| `post.format` | テキスト抽出方法 |
|---|---|
| `tiptap` | JSON ツリーを再帰的に走査し、`text` ノードの値を結合。 |
| `markdown` | fenced code、インラインコード、画像・リンク構文、太字・斜体マーカー、HTML タグを除去。 |
| `html` | HTML タグを除去。 |
| `static` | 空文字を返す — バッジは出力されない。 |

## ラベルの escape

ラベル文字列はプレースホルダー置換後に HTML escape されます。`< > & " '` は `&lt; &gt; &amp; &quot; &#39;` に変換されるため、管理画面の `labelTemplate` 設定に不等号が含まれていても XSS は発生しません。

## トラストレベル

`untrusted`。`@ampless/runtime` が検証・サニタイズする HTML descriptor を返すだけです。DynamoDB、S3、Lambda プロセッサーには一切触れません。

## v1 では対応しないこと

- **テーマ CSS** — `<p>` 要素には安定したクラス名（`ampless-reading-time`）が付与されるのでテーマ側でスタイリングできます。デフォルト CSS は注入しません。
- **ロケール別ラベル** — `labelTemplate` は全ロケール共通の単一文字列です。多言語サイトでは `instanceId` を別にしてプラグインを 2 回登録し、テーマ側でスロットを条件分岐させることで対応できます。
- **文字種別 WPM のカスタマイズ** — `wordsPerMinute` 設定は一律適用されます。アラビア語とラテン語で別レートを設定するなど、文字種別の細かな調整は deferred です。
