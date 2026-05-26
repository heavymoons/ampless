> English: [03-content-management.md](./03-content-management.md)
> 
## 3. コンテンツ管理

### エディタ

リッチテキストエディタには **tiptap (MIT)** を採用。

- ProseMirror ベースのヘッドレスエディタ。フレームワーク非依存。
- 現状の管理画面が必要とする範囲は MIT の Extension 群でカバーできる。
- tiptap の有料機能（リアルタイム共同編集・AI 等）は不要。

管理画面に組み込まれている Extension は以下 ([`packages/admin/src/editor/tiptap-editor.tsx`](../../packages/admin/src/editor/tiptap-editor.tsx))：

- `StarterKit`（paragraph / heading / list / code block / blockquote / hr / hard break / インラインマーク）
- `Link`、`Image`（画像表示方法用に `display` 属性を独自拡張）
- `Table`、`TableRow`、`TableHeader`、`TableCell`（列幅リサイズ対応）
- `TaskList`、`TaskItem`（ネスト対応）
- `Underline`、`Highlight`、`TextAlign`

同じノードセットの SSR 用レンダラが [`packages/runtime/src/rendering.ts`](../../packages/runtime/src/rendering.ts) にあり、エディタ出力と公開ページの HTML を一致させている。

#### エディタ選定の経緯

| 候補 | 見送り理由 |
|------|-----------|
| @portabletext/editor (Sanity) | MIT だが React 専用。Extension エコシステムが小さい。Sanity 色が強い |
| Lexical (Meta) | MIT。有力候補だが tiptap より CMS 向け Extension が少ない |
| Plate (Slate ベース) | MIT。shadcn/ui 連携は良いが、tiptap ほど成熟していない |

### データモデル：マルチフォーマット保存

Post / Page は `format` フィールドを持ち、`body` カラムは JSON だが中身の形は `format` で決まる：

| `format` | `body` の中身 | 主な用途 |
|----------|---------------|----------|
| `tiptap` | tiptap document JSON (`{ type: 'doc', content: [...] }`) | 管理画面の WYSIWYG 編集 |
| `markdown` | Markdown ソース文字列 | 開発者、git push 運用、AI エージェント |
| `html` | HTML ソース文字列 | 移行データ、手書き HTML |
| `static` | バンドルマニフェスト（後述） | 事前にビルド済みの HTML/CSS/JS バンドルを丸ごと公開 |

スキーマは [`packages/backend/src/data/index.ts`](../../packages/backend/src/data/index.ts)、ランタイム型は [`packages/ampless/src/types.ts`](../../packages/ampless/src/types.ts) に定義されている。

**設計方針**

- canonical な body は常に1つ。フォーマット間変換はベストエフォートで、エディタ側で `format` を切り替えたとき**だけ**走る（[`tiptapToHtml` / `htmlToMarkdown` / `tiptapToMarkdown` / `markdownToHtml`](../../packages/runtime/src/rendering.ts)）。
- DynamoDB Item は軽量に保つ。400 KB 制限があるので、画像 base64 を埋め込んだ巨大 HTML 等は明確なアンチパターン。
- `format: 'static'` は実バイトを DynamoDB から外して S3 に置き、`body` には manifest のみを格納する。

#### レンダリングパイプライン

ランタイムは body を**リクエスト時にレンダリング**する。公開時点で HTML を S3 に焼き込むという書き出しパスは存在しない。流れは以下の通り：

```
ブラウザ → Next.js middleware（rewrite + Cache-Control）→ テーマ dispatcher
        → renderBody(post) (packages/runtime/src/rendering.ts)
        → tiptap JSON | markdown | html → HTML 文字列 → テーマコンポーネント
```

レスポンスの再配信を安価にしているのは Cache-Control ヘッダ（後述「キャッシュ戦略」）。

派生アセットのうち S3 に実体を持つものは、投稿本文のパイプラインではなくプラグイン／イベントハンドラ経由で書き込まれる：

- `public/site-settings.json` — サイト設定変更時に trusted イベントプロセッサが書き出す ([`packages/backend/src/events/processor-trusted.ts`](../../packages/backend/src/events/processor-trusted.ts))。
- `public/plugins/<plugin>/<key>` — trusted プラグインが `ctx.writePublicAsset` で書き出す任意の成果物（RSS、OG 画像、sitemap.xml 等）。
- `public/static/<slug>/...` — `format: 'static'` 投稿のファイル実体。

### `format: 'static'` の投稿

`format: 'static'` は、ビルド済みの静的ページ（LP、デモ、アーカイブ HTML 等）をテーマで包まずそのまま配信したい場合に使う。tiptap / marked を通さない。

- body 形式：`{ entrypoint, files, uploadedAt }`（[`packages/ampless/src/types.ts`](../../packages/ampless/src/types.ts) の `StaticPostBody`）。
- ファイル実体は S3 の `public/static/<slug>/...` に置かれる。
- 公開 URL：middleware が `/<slug>` をエントリポイントへ、`/<slug>/<path>` を内部ファイルへ rewrite する ([`packages/runtime/src/middleware.ts`](../../packages/runtime/src/middleware.ts)、[`packages/runtime/src/routes/static.ts`](../../packages/runtime/src/routes/static.ts))。
- 厳格な制約：HTML/CSS/SVG の中の参照は**必ず相対パス**でなければならない。`/foo` のような絶対パスや `//cdn/foo` のような protocol-relative はアップロード時に拒否される。検証ロジックとエントリポイント推定は管理画面と MCP で共有 ([`packages/ampless/src/static-bundle.ts`](../../packages/ampless/src/static-bundle.ts))。
- 投入経路：
  - 管理画面：[`StaticUploader`](../../packages/admin/src/components/static-uploader.tsx)（zip をドラッグ）。
  - MCP：`upload_static_bundle`（zip 一括）、`upload_static_file` / `delete_static_file`（差分操作）、`commit_static_post`（S3 の現状から manifest を再構築）。`create_post` / `update_post` は `format=static` を**意図的に拒否**し、manifest と S3 のズレを防いでいる。

### レイアウトモード

`metadata` でテーマがどう本文をラップするかを決める。判定は middleware が `{ format, metadata, updatedAt }` の小さな射影 1 回だけで行い、Lambda ウォームキャッシュに 60 秒入れている。

| `format` / `metadata.no_layout` | 公開 URL | middleware の rewrite | レンダラ |
|---|---|---|---|
| themed（デフォルト） | `/<slug>` | （rewrite なし） | `app/[slug]/page.tsx` → テーマの `components.Post` |
| `metadata.no_layout: true` | `/<slug>` | `/raw/<slug>` | `app/raw/[slug]/route.ts` — テーマ chrome なしの素の HTML |
| `format: 'static'` | `/<slug>` と `/<slug>/<path>` | `/static/<slug>(/...)` | `app/static/[slug]/[[...path]]/route.ts` — S3 presigned URL に redirect |

そのため `raw` と `static` は予約済み slug となる。

### キャッシュ戦略

`metadata.cache` (`'auto' | 'deep' | 'hot'`) と `cms.config.cache.*` の設定値から middleware がレスポンスの `Cache-Control` を組み立てる。

- `auto`（デフォルト）— 編集時刻基準のクールダウン。`updatedAt` が `cache.cooldownMs`（デフォルト 1 時間）以内なら `no-store` を返し、編集直後の表示が即時反映される。クールダウンを過ぎたら `s-maxage=cache.freshTtlSeconds`（デフォルト 300 秒）。
- `deep` — 常に長期キャッシュ（`cache.deepTtlSeconds`、デフォルト 1 時間）。内容がほぼ固定の投稿向け。
- `hot` — 常に `no-store`。動的に変わる、あるいは分単位で更新される投稿向け。

型定義は `PostMetadata` / `CacheStrategy` / `CacheConfig` ([`packages/ampless/src/types.ts`](../../packages/ampless/src/types.ts))。

### サイトモデル

1 Amplify デプロイ = 1 サイト。複数サイトを運用したい場合は Amplify デプロイ自体を分ける。

これは読み取りパスをエッジでキャッシュ可能に保つための選択でもある。Amplify Hosting の CloudFront キャッシュキーは Host を含まないため、1 デプロイで複数ドメインを振り分けるモードでは SSR レスポンスを安全にキャッシュできず、`Cache-Control: private, no-store` を強制せざるを得ない。サイトごとにデプロイを分ければそのトレードオフは発生しない。

### メディア管理

#### ストレージ

アップロードされたメディアは S3 の `public/media/YYYY/MM/<epochMs>-<sanitizedName>` に保存される。Media の DynamoDB レコードは相対 `src` のみを持ち、表示 URL はレンダリング時に解決する。

```json
{
  "mediaId": "photo-001",
  "src": "media/2026/04/1714400000000-photo.jpg",
  "mimeType": "image/jpeg",
  "size": 1024000,
  "delivery": "nextjs"
}
```

バケットのアクセスポリシー ([`packages/backend/src/storage/index.ts`](../../packages/backend/src/storage/index.ts))：

- `public/media/*` — ゲスト read、admin/editor read+write+delete。
- `public/plugins/*` — ゲスト read、admin read+write+delete。
- `public/static/*`、`public/site-settings.json` — バケットポリシーで `defineAmplessBackend` 内に追加。

#### 配信方式

`cms.config.media.delivery` で URL の組み立て方を切り替える。

```typescript
// cms.config.ts
export default defineConfig({
  media: {
    delivery: 'nextjs',      // デフォルト：管理画面の /api/media 経由でプロキシ
    // delivery: 's3-direct', // S3 を直接参照（公開 read バケットポリシー前提）
  }
})
```

| 方式 | URL 例 | 振る舞い |
|------|--------|----------|
| `nextjs`（デフォルト） | `/api/media/2026/04/photo.jpg` | 管理画面のルートハンドラ ([`media-proxy.ts`](../../packages/admin/src/api/media-proxy.ts)) が Amplify SSR 経由で S3 presigned URL を短時間で発行し、302 リダイレクトで返す。バケットは非公開のまま。 |
| `s3-direct` | `https://<bucket>.s3.<region>.amazonaws.com/public/media/...` | S3 を直接参照。バケットの公開 read ポリシーが必要。前段に CDN を置く構成向き。 |

URL 解決は [`publicMediaUrl`](../../packages/admin/src/lib/media.ts) に集約されており、`cms.config.media.delivery` と `amplify_outputs.json` を見て URL を組み立てる。テンプレートはこれを `lib/media.ts` から再エクスポートしているので、テーマ側は `publicMediaUrl(src)` を呼ぶだけでよい。

画像最適化が必要なテーマは `publicMediaUrl` の戻り値を `next/image` でラップすればよく、ampless 側で最適化方式を強制はしない。

#### 画像アップロードのパイプライン

画像のアップロードはクライアント側で処理を挟む ([`packages/admin/src/components/image-upload-dialog.tsx`](../../packages/admin/src/components/image-upload-dialog.tsx))：

- 任意のクロップ（`free` / 1:1 / 4:3 / 16:9 / 3:2）。
- 長辺クランプ（`media.processing.maxDimension`、デフォルト 2400 px）。
- 出力フォーマット（`webp` / `jpeg` / `original`）と品質スライダー（`media.processing.quality`、デフォルト 0.85）。PNG 入力は `media.processing.losslessForPng` がデフォルト ON なので可逆 WebP になる。
- "useOriginal" チェックで処理を完全にスキップ可能。

これによりサーバ側で再エンコードする必要がなく、S3 に届くバイト列は管理画面で見た通りのものになる。

### コンテンツ分類

- **タグ**は Post の `string[]` フィールドとして保存し、書き込みのたびに `PostTag` テーブルに非正規化複製する。`PostTag` は `PK = tag`、`SK = "<publishedAt>#<postId>"` なので、公開向け `listPostsByTag` クエリは新着順 1 回の `Query` で済む。
- **カテゴリ**はスキーマに `Taxonomy` モデルだけ用意してあるが、管理画面 UI は未実装。後続リリース向けの予約枠。
- **Page** は Post と同じ `format` enum を使うが、タグ関係は持たない。サイトの構造ページ（About、Privacy 等）用途を想定。

### スキーマ拡張

ampless は固定モデル（Post、Page、Media、Taxonomy、PostTag、KvStore、McpToken）を出荷する。独自モデルはユーザの `a.schema({...})` に `amplessSchemaModels(a)` を spread した上で追加する：

```ts
// amplify/data/resource.ts
const schema = a.schema({
  ...amplessSchemaModels(a),
  Recipe: a.model({ /* ... */ }).authorization(/* ... */),
})
```

WordPress 的な「全部 `wp_posts` に詰め込む」モデル、あるいはスキーマを動的に組み立てる CMS との明示的なトレードオフ：ユーザモデルは Amplify の codegen / 型推論 / IAM をフルに受け取れるが、管理画面のフォーム操作ではなくコード変更が必要になる。

### WordPress からの移行

WordPress からの移行は **ロードマップ項目で、現時点では未実装**（[docs/architecture/14-roadmap.md](./14-roadmap.md) に記載）。着手時の想定スコープ：

- WXR ファイルから posts、pages、media、taxonomies をインポート。
- インポートした HTML は `format: 'html'` でそのまま保存。
- WordPress のプラグイン・テーマ・Gutenberg ブロックは明示的にスコープ外。
- カスタム投稿タイプ（CPT）と ACF は上記「スキーマ拡張」を使って手動マッピングが必要。

---
