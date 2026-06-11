> English: [README.md](./README.md)
>

# @ampless/plugin-schema-jsonld

[ampless](https://github.com/heavymoons/ampless) 向け JSON-LD 構造化データ (Article スキーマ) プラグイン。

> **プレリリース / ベータ版。** v1.0 まではマイナーバージョンでも破壊的変更が入る可能性があります。

`publicBodyForPost` フック (Phase 4) を使って、投稿ページの body 内に `<script type="application/ld+json">` 要素を出力します。スクリプトには、投稿フィールドと 4 つの管理設定から組み立てた [schema.org](https://schema.org/) Article 系オブジェクトが格納されます。

AWS のデータ権限は不要です。プラグインは公開 Next.js プロセス内でリクエスト時に動くだけの純粋関数です。`trust_level` は `untrusted`。

## インストール

```bash
npm install @ampless/plugin-schema-jsonld@beta
```

## 設定

`cms.config.ts` に記述します:

```ts
import { defineConfig } from 'ampless'
import schemaJsonLdPlugin from '@ampless/plugin-schema-jsonld'

export default defineConfig({
  // ...
  plugins: [
    schemaJsonLdPlugin(),
  ],
})
```

オプションはすべて省略可能です。著者名・発行者名は空のとき `site.name` にフォールバックします:

```ts
schemaJsonLdPlugin({
  articleType:    'BlogPosting',   // デフォルト: 'Article'
  authorName:     'Jane Smith',    // デフォルト: site.name
  publisherName:  'Acme Blog',     // デフォルト: site.name
  publisherLogo:  'https://example.com/logo.png',  // デフォルト: 省略
})
```

| オプション | デフォルト | 備考 |
|---|---|---|
| `articleType` | `'Article'` | schema.org の `@type`。`Article`、`NewsArticle`、`BlogPosting`、`TechArticle` から選択。`/admin/plugins` から上書き可能。 |
| `authorName` | `site.name` | スキーマ内の著者 `Person` の名前。空文字または未指定 → `site.name`。 |
| `publisherName` | `site.name` | 発行者 `Organization` の名前。空文字または未指定 → `site.name`。 |
| `publisherLogo` | _(省略)_ | 発行者ロゴ画像の絶対 URL。空文字または未指定 → スキーマからロゴを省略。 |
| `instanceId` | `'schema-jsonld'` | script 要素 id の namespace。2 つのインスタンスを登録する場合にのみ必要。 |

## 管理画面からの設定

上記 4 つのオプションは `/admin/plugins` から編集できる管理設定としても公開されています。管理画面で保存した値はコンストラクタオプションより優先されるため、サイトを再デプロイせずに変更できます。

## アーティクル種別の選び方

| `@type` | 適した用途 |
|---|---|
| `Article` | 汎用のデフォルト。一般的なブログや企業ニュースに最適。 |
| `BlogPosting` | 個人ブログや非公式な記事。Google はリッチリザルトの扱いを `Article` と同等にしています。 |
| `NewsArticle` | ニュース・ジャーナリズムサイト。Google ニュースのリッチリザルト対象。 |
| `TechArticle` | 技術ドキュメントやハウツーガイド。 |

適格性ガイドラインは [Google の構造化データドキュメント](https://developers.google.com/search/docs/appearance/structured-data/article) を参照してください。

## Google リッチリザルトテストで確認

デプロイ後、以下で出力を確認できます:

**<https://search.google.com/test/rich-results>**

1. サイト上の任意の投稿 URL を入力します。
2. ツールが `<script type="application/ld+json">` ブロックを解析し、検出したエンティティ種別を表示します。
3. 「有効なアイテムが検出されました」と表示されれば、スキーマが正しく認識されています。

## トラストレベル

`untrusted`。プラグインは `@ampless/runtime` が検証・描画する body descriptor を返すだけです。DynamoDB、S3、Lambda プロセッサーには一切触れません。

## 既知の制約

- **著者・発行者が `site.name` にフォールバック** — プラグインは投稿単位の著者レコードにアクセスしません。`authorName` と `publisherName` が空（デフォルト）のとき、どちらも `site.name` を使います。管理設定またはコンストラクタオプションで実名を設定してください。
- **tags → `keywords` へのマッピング** — `post.tags`（存在する場合）は `, ` で結合されて `keywords` フィールドに書き込まれます。`ItemList` ではなくカンマ区切り文字列です。
- **ホームページ・一覧ページでは出力されない** — `publicBodyForPost` は投稿個別ページにのみ呼ばれます。インデックスページやタグ一覧などの非投稿ページにはディスクリプタが出力されません。
- **`BlogPosting` vs `Article`（Google の扱い）** — Google はリッチリザルトにおいてどちらも同等に扱います。非公式な記事には `BlogPosting`、編集コンテンツには `Article`、ニュース媒体を運営している場合のみ `NewsArticle` を選んでください。
- **image フィールド** — 投稿にカバー画像 URL がある場合でも、現時点では `image` フィールドをスキーマに含めません。将来のリリースで対応予定です。
