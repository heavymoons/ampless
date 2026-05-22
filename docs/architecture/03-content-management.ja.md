> English: [03-content-management.md](./03-content-management.md)
> 
## 3. コンテンツ管理

### エディタ

リッチテキストエディタには **tiptap (MIT)** を採用。

- ProseMirror ベースのヘッドレスエディタ。フレームワーク非依存
- Extensions エコシステムが豊富（ドラッグ＆ドロップ、スラッシュコマンド、文字数カウント等）
- EmDash も同じく tiptap を採用（Portable Text 変換レイヤー付き）
- tiptap の有料機能（リアルタイム共同編集、AI 等）は不要。MIT 部分で十分

#### エディタ選定の経緯

| 候補 | 見送り理由 |
|------|-----------|
| @portabletext/editor (Sanity) | MIT だが React 専用。Extensions エコシステムが小さい。Sanity 色が強い |
| Lexical (Meta) | MIT。有力候補だが tiptap より CMS 向け Extensions が少ない |
| Plate (Slate ベース) | MIT。shadcn/ui 連携は良いが、tiptap ほど成熟していない |

### データモデル: マルチフォーマット保存

コンテンツの保存形式をユーザーが選択できる設計とする。

#### canonical（正データ）— DynamoDB に保存

ユーザーが編集に使うフォーマットを canonical（正データ）として DynamoDB に保存する。
`format` フィールドで形式を明示。

```json
{
  "siteId": "default",
  "postId": "post-001",
  "title": "記事タイトル",
  "format": "tiptap",
  "body": { "type": "doc", "content": [...] },
  "updatedAt": "2026-04-04T..."
}
```

| format | body の内容 | 想定ユーザー |
|--------|-----------|------------|
| `tiptap` | tiptap JSON | WYSIWYG エディタ派 |
| `markdown` | Markdown 文字列 | 開発者、git push 運用派 |
| `html` | HTML 文字列 | WordPress 移行組、レガシー |

#### 派生フォーマット — S3 にキャッシュ

公開・配信時に canonical から変換した派生フォーマットを S3 に保存する。

```
[保存/公開時]
  canonical (DynamoDB) → HTML → S3 (配信用)
  canonical (DynamoDB) → Markdown → S3 (エクスポート用、必要時)
  canonical (DynamoDB) → RSS XML → S3
```

S3 側はいつでも再生成可能なキャッシュとして扱う。

#### フォーマット間変換

canonical フォーマットの変更（例: tiptap → Markdown への移行）にも対応する。
変換は損失を伴う場合があり、ユーザーに確認の上で実行する。

| 変換 | ライブラリ | 品質 |
|------|-----------|------|
| tiptap JSON ↔ HTML | `@tiptap/html`（公式） | ほぼ無損失 |
| tiptap JSON ↔ Markdown | `tiptap-markdown`（コミュニティ） | 損失あり（装飾・カスタムブロック） |
| Markdown → HTML | `markdown-it` 等 | 無損失 |
| HTML → tiptap JSON | `@tiptap/html` の `generateJSON()` | ほぼ無損失 |

#### 設計方針
- canonical は常に1つ。複数の canonical を持たない（同期地獄の回避）
- DynamoDB には canonical + メタデータのみ保存し、軽量に保つ
- 派生フォーマットは S3 にキャッシュ
- DynamoDB の 400KB Item サイズ制限を意識し、巨大コンテンツは S3 に逃がす

### サイトモデル

1 Amplify デプロイ = 1 サイト。複数サイトを運用したい場合は Amplify デプロイ自体を分ける。

スキーマには `siteId` カラムが残っているが、値は常に `"default"` 固定で、現状は意味を持たない（将来的にマルチサイトを再導入する場合に備えた前方互換のためのフック）。

過去には 1 デプロイで複数ドメインを振り分ける「マルチサイトモード」が存在したが、Amplify Hosting の CloudFront キャッシュキーが Host を含まないため SSR レスポンスを安全にキャッシュできず、`Cache-Control: private, no-store` を強制せざるを得なかった。読み取りパスのエッジキャッシュを失うコストが、デプロイを分ける運用コスト（実際 全運用者はそうしていた）より大きかったため撤去した。

### メディア管理

#### ストレージ

アップロードされたメディアファイルは S3 の `public/media/` に保存する。
DynamoDB には相対パスのみを保存し、配信 URL はレンダリング時に解決する。

```json
{
  "mediaId": "photo-001",
  "src": "media/2026/04/photo.jpg",
  "mimeType": "image/jpeg",
  "size": 1024000,
  "delivery": "nextjs"
}
```

#### 配信方式

デフォルトは `next/image` 経由のプロキシ配信。`cms.config.ts` で明示的に変更可能。

```typescript
// cms.config.ts
export default defineConfig({
  media: {
    delivery: 'nextjs',     // デフォルト: next/image 経由（自動最適化）
    // delivery: 's3-direct', // 直接 S3 URL を使う場合
  }
})
```

| 方式 | URL 例 | 用途 |
|------|--------|------|
| `nextjs`（デフォルト） | `/_next/image?url=...` | 画像（WebP変換・リサイズ・遅延読み込み） |
| `s3-direct` | `https://{bucket}.s3.amazonaws.com/public/...` | 動画・PDF・大容量ファイル |

動画・PDF など `next/image` が処理できない MIME タイプは、設定に関わらず自動的に `s3-direct` にフォールバックする。

#### URL 解決

DB には常に相対パスを保存し、表示時に `resolveMediaUrl()` で完全 URL に変換する。
将来 CloudFront を追加した場合もこの関数を変更するだけで全体に反映される。

```typescript
function resolveMediaUrl(src: string, mimeType: string, delivery: 'nextjs' | 's3-direct') {
  const isImage = mimeType.startsWith('image/')
  if (!isImage || delivery === 's3-direct') {
    return `https://${BUCKET}.s3.amazonaws.com/public/${src}`
  }
  return `/_next/image?url=${encodeURIComponent(`/api/media/${src}`)}&w=1200&q=75`
}
```

### その他
- カスタムコンテンツタイプは管理画面からスキーマ定義 → DynamoDB テーブルを生成
- WordPress の「全部を1つの posts テーブルに詰め込む」問題を回避

### WordPress からの移行
- WXR ファイルインポートに対応
- 投稿、ページ、メディア、タクソノミーの移行をサポート
- WordPress プラグイン・テーマは移行不可（アーキテクチャが根本的に異なる）
- カスタム投稿タイプ（CPT）と ACF は手動スキーママッピングが必要
- インポートした HTML コンテンツは `format: "html"` でそのまま保存可能

---
