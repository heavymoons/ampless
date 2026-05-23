> English: [CONTENT.md](./CONTENT.md)
> 
# 投稿の作成

投稿（Post）は ampless が標準で提供する唯一のコンテンツタイプです。ブログ記事、ニュース、About ページ、マーケティングランディングページ、そして zip でアップロードする静的 HTML/CSS/JS バンドルまで、これ 1 つでカバーします。投稿のレンダリングを決定する要素は次の 5 つです。

| 設定項目 | 場所 | 効果 |
| --- | --- | --- |
| `format` | 投稿エディター | 本文の保存・解釈方法（`tiptap` / `markdown` / `html` / `static`） |
| `no_layout` | 投稿エディター（`format: 'html'` のときのみ表示） | 本文をそのまま出力し、Next.js のルートレイアウトもテーマのクロームも適用しない |
| `cache` | `metadata.cache`（auto/deep/hot） | 投稿ごとのキャッシュ戦略を上書き |
| `slug` | 投稿エディター | 公開 URL |
| `status` | 投稿エディター | `published` は公開される；`draft` は管理者のみ閲覧可 |

## フォーマット

- **Tiptap** — リッチテキストエディター。構造化ドキュメントとして保存されます。ブログスタイルのコンテンツに最適なデフォルト選択肢です。画像、リンク、見出し、リストに対応。
- **Markdown** — プレーンテキストエリア。ampless は最小限のレンダラー（見出し、太字、コード、リスト、段落）を同梱しています。Markdown の全機能が必要な場合は独自のレンダラーを導入してください。
- **HTML** — プレーンテキストエリア。本文はそのままレンダリングされます — サニタイズは行いません。エディター（あなた）は信頼済みプリンシパルとして扱われます。カスタム HTML / インライン `<style>` / スクリプトが必要な場合に便利です。トラストモデルについては [docs/architecture/04-access-layer-mcp.ja.md](./architecture/04-access-layer-mcp.ja.md) を参照してください。
- **Static** — HTML / CSS / JS / 画像 / フォントなどを含む `.zip`（またはフォルダのドラッグ&ドロップ）をアップロードする形式です。ampless がバンドルを展開して S3 に保存し、公開サイトから配信します。後述の「静的バンドル」を参照してください。

## `no_layout: true` — ベア HTML ページ

`<head>` の完全制御、カスタム `<style>`、トラッキングピクセルなど、Next.js のルートレイアウトやテーマのクロームと共存できない内容を配信したい場合は、**`format: 'html'`** にした上で投稿エディターの **No layout** チェックボックスをオンにします。

内部の挙動は次のとおりです:

- フラグは投稿の `metadata.no_layout: true` として保存されます。
- プロキシ（middleware）が AppSync から取得した `format: 'html'` + `metadata.no_layout: true` を見て、`/<slug>` リクエストを内部のベア HTML ハンドラーに書き換えます。
- ハンドラーが投稿本文を `text/html` でそのまま返します。**Next.js のルートレイアウトもテーマのクロームも適用されません**。ブラウザの URL は `/<slug>` のままです。

```
slug: promo
format: html
no_layout: ☑
body: <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>Promo</title>
        <meta name="description" content="..." />
        <style>body { ... }</style>
      </head>
      <body>
        ...
      </body>
      </html>
```

`/promo` にアクセスすると → 本文がそのまま HTTP レスポンス全体として返されます。

### `no_layout` は `format: 'html'` 専用

**No layout** チェックボックスは `format: 'html'` のときだけ表示されます。tiptap や markdown 本文で「レイアウトなし」にしても、`<!DOCTYPE>` も `<head>` もない、文脈のない HTML フラグメントが返されるだけだからです。フォーマットを `html` 以外に変更すると、フラグは自動的にクリアされます。

## 静的バンドル（`format: 'static'`）

静的投稿は、プレーンな HTML / CSS / JS / 画像 / フォントのファイル群をそのままホスティングします。マーケティング用のマイクロサイト、手作りのランディングページ、他のジェネレーターから書き出した SPA、デザインの実験など、ブログ記事ではないがサイトのドメイン配下に置きたいコンテンツに向いています。

### アップロード方法

投稿エディターで **format: static** を選びます。本文エリアが `StaticUploader` に切り替わります:

- バンドルの `.zip` をドロップ、**または**
- フォルダをドラッグ（Chrome / Edge の `webkitdirectory` 対応）、**または**
- 複数ファイルを選択

ampless はブラウザ上で zip を展開してファイル一覧を検証し、投稿の保存時に各ファイルを S3 にアップロードします。再保存時には先に既存バンドルを削除してから新バンドルをアップロードします — バンドルはアトミックに置換され、マージはしません。

### アップロードできるもの

| 拡張子 | 備考 |
| --- | --- |
| `.html`, `.htm` | `text/html` として配信 |
| `.css`, `.js`, `.mjs`, `.json` | そのまま配信 |
| `.svg`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.ico` | 画像 |
| `.woff`, `.woff2`, `.ttf`, `.otf`, `.eot` | フォント |
| `.pdf`, `.txt`, `.xml`, `.map` | その他 |
| 未知の拡張子 | `application/octet-stream` として配信 |

最大バンドルサイズ: **非圧縮で 50 MB**。macOS のメタデータ（`__MACOSX/`、`.DS_Store`）や Windows の `Thumbs.db` は自動で除去されます。共通の最上位ディレクトリは自動で展開されます — `mybundle.zip` をドロップすれば `mybundle/index.html` は `/<slug>/index.html` になります。

HTML / CSS / SVG ファイルは検証時に絶対パス参照（`href="/style.css"`、`url(/img.png)`）やパストラバーサル（`../`）の有無がチェックされます。違反しているファイルは UI に一覧表示され、修正するまで保存はブロックされます。**相対パス**（`./style.css`、`assets/img.png`）で記述してください。

### URL 構造

```
/<slug>                    → 308 リダイレクト → /<slug>/  （末尾スラッシュへ正規化）
/<slug>/                   → entrypoint の S3 presigned URL に 302
/<slug>/assets/style.css   → S3 の presigned URL に 302
```

ブラウザに表示される URL は常に `/<slug>` / `/<slug>/<path>` です — middleware がリクエスト時に内部の静的バンドルハンドラーに書き換えます。`entrypoint` のデフォルトは `index.html` で、アップロードされたファイルから自動検出されます。アップローダー UI で上書きも可能です。バンドル内のすべてのファイルは `/<slug>/<相対パス>` でアクセスできます。

### 保存先

```
s3://<bucket>/public/static/<slug>/...
```

S3 バケットは非公開のままです。公開ルートが必要に応じて短命（1 時間）の presigned URL に署名し、ブラウザを 302 でそこにリダイレクトします。アセット本体は S3 が直接配信します。

### 制限

- バンドルは実行されません — あくまで静的アセットです。`.php` や Lambda などは載せられません。
- バンドル内の差分更新はできません — 保存のたびにバンドル全体が置換されます。
- 絶対パス、`../` のトラバーサル、null バイトは検証で弾かれます。相対パスで記述してください。

## キャッシュ戦略（`metadata.cache`）

各投稿レスポンスには、proxy（middleware）が計算した `Cache-Control` ヘッダが付与されます。デフォルトは**編集時刻ベースのクールダウン** — 直近の編集は `no-store` で常に最新を配信し、クールダウン経過後は CDN キャッシュ可能になります。

`metadata.cache` で投稿ごとに上書き可能:

| 値 | 挙動 |
| --- | --- |
| `'auto'`（デフォルト） | `updatedAt` から `cms.config.cache.cooldownMs`（デフォルト 1 時間）以内は `no-store`、それ以降は `public, max-age=<freshTtlSeconds>, s-maxage=<freshTtlSeconds>`（デフォルト 5 分）。 |
| `'deep'` | 常に `public, max-age=<deepTtlSeconds>, s-maxage=<deepTtlSeconds>`（デフォルト 1 時間）。当面内容が変わらない投稿向け。 |
| `'hot'` | 常に `no-store`。頻繁に書き換わる投稿、本文をリクエストごとに計算する用途向け。 |

プロジェクト全体のチューニングは `cms.config.ts` で行います:

```ts
export default defineConfig({
  // ...
  cache: {
    cooldownMs: 60 * 60 * 1000, // 1 時間 — auto 戦略のクールダウン
    freshTtlSeconds: 300,       // 5 分 — auto クールダウン後の TTL
    deepTtlSeconds: 60 * 60,    // 1 時間 — deep 戦略の TTL
  },
})
```

`metadata.cache` は `metadata.no_layout` や `format` から独立しています — テーマレンダリング、no_layout、static のいずれにも同じ 3 種類の戦略がそのまま適用されます。

## URL まとめ

| 投稿の設定 | 公開 URL | レンダラー |
| --- | --- | --- |
| `format: 'tiptap' \| 'markdown' \| 'html'`（`no_layout` なし） | `/<slug>` | テーマの投稿ページ（ヘッダー / フッターなど） |
| タグ一覧 | `/tag/<tag-name>` | テーマのタグページ |
| `format: 'html'` + `no_layout: true` | `/<slug>` | ベア HTML ルート（レイアウトなし、クロームなし） |
| `format: 'static'` | `/<slug>/` | S3 の presigned URL 経由で配信される静的バンドル |

## ホームページのフィーチャード / ピン留めコンテンツ

対応するテーマ（現在は blog / landing / corporate）には、`/admin/sites/<siteId>/theme` にある `featuredSlug` マニフェストフィールドがあります。公開済み投稿のスラグを設定すると、テーマはその投稿の本文をホームページ上部にインライン表示し、重複を避けるために同じスラグを通常フィードから除外します。各テーマがフィーチャードブロックをどこに配置するかは [THEMES.ja.md](./THEMES.ja.md) を参照してください。
