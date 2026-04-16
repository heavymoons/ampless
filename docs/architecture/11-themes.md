## 11. テーマ

### 設計思想

テーマはプラグインと同じ枠組みで扱う。
管理画面からのインストール・切り替え・プレビューに対応し、npm や git push を不要にする。

テーマ = レイアウト（テンプレート構造）+ スタイル（CSS）+ カスタマイズスキーマ。

### テーマの構成要素

```typescript
// @ampless/theme-blog
export default defineTheme({
  apiVersion: 1,
  name: 'Blog',
  description: 'シンプルなブログテーマ',
  thumbnail: '/themes/blog/thumbnail.png',

  // カスタマイズ可能な項目を宣言 → 管理画面が UI を自動生成
  configSchema: {
    primaryColor: { type: 'color', default: '#3b82f6', label: 'メインカラー' },
    fontFamily: { type: 'select', options: ['sans', 'serif', 'mono'], default: 'sans', label: 'フォント' },
    logo: { type: 'image', label: 'ロゴ' },
    showSidebar: { type: 'boolean', default: true, label: 'サイドバー表示' },
  },

  layouts: { default, post, list },
  slots: ['head', 'before-content', 'after-content', 'sidebar', 'footer'],
})
```

### テーマの配布とインストール

プラグインの配布方式（§9）と同じ仕組みに乗る。

| 方式 | ユーザー | 操作 |
|------|---------|------|
| **管理画面から** | 非開発者 | テーマ一覧から選んで「適用」。npm/git 不要 |
| **npm install** | 開発者 | `npm install @ampless/theme-docs` → git push |
| **eject** | 上級者 | `npx ampless eject-theme` でローカルコピーに切り替え |

管理画面からのインストール:

```
管理画面「テーマ変更」
  → テーマ一覧（サムネイルプレビュー付き）
  → テーマパッケージを S3 にダウンロード
  → DynamoDB にテーマ設定を保存
  → 次のリクエストから新テーマで描画
```

テーマは管理者のみがインストール可能（role: admin）。
信頼済みコードとして扱い、プラグインの trust_level によるサンドボックスは適用しない。

### テーマの切り替えとプレビュー

実際のコンテンツを使って、複数テーマを見比べてから適用できる。

```
┌─────────────────────────────────────────────┐
│ テーマ設定                                    │
├──────────┬──────────────────────────────────┤
│          │                                    │
│ テーマ選択 │   ┌────────────────────────┐     │
│ ● Blog   │   │                          │     │
│ ○ Docs   │   │    iframe プレビュー       │     │
│ ○ Corp   │   │  （実際のコンテンツ表示）   │     │
│          │   │                          │     │
│ カスタマイズ│   └────────────────────────┘     │
│ 色: [■]  │                                    │
│ フォント   │              [テーマを適用]        │
│ ロゴ      │                                    │
└──────────┴──────────────────────────────────┘
```

- プレビューは iframe + URL パラメータでテーマを指定（管理者セッションのみ）
- カスタマイズ項目を変えるたびに iframe がリアルタイム更新
- 「テーマを適用」を押すまで公開サイトには反映されない

```typescript
// middleware.ts
export function middleware(request: NextRequest) {
  const theme = request.nextUrl.searchParams.get('theme')
  const preview = request.nextUrl.searchParams.get('preview')

  if (preview && isAdminSession(request)) {
    request.headers.set('x-theme', theme)
  }
}
```

### キャッシュ戦略

テーマの描画結果は Next.js ISR でキャッシュし、テーマ Lambda の呼び出しを最小化する。

```
初回アクセス → テーマで描画 → HTML キャッシュ（ISR）
以降のアクセス → キャッシュから配信
コンテンツ更新 → DynamoDB Stream → SQS → キャッシュ再生成
テーマ変更   → 全ページのキャッシュを無効化 → 順次再生成
```

### 管理画面の UI

管理画面自体はテーマと独立。shadcn/ui + Tailwind で構成。

| 領域 | 技術 | 理由 |
|------|------|------|
| 管理画面 `(admin)/` | shadcn/ui + Tailwind | フォーム・テーブル・ダイアログ等が揃っている |
| 公開サイト `(public)/` | テーマ依存（Tailwind ベース） | テーマごとにデザインが異なる |

### スロット（挿入ポイント）

テーマはプラグインがコンテンツを差し込める**スロット**を宣言する。

```tsx
// テーマ側: 記事ページ
export default function PostPage({ post }) {
  return (
    <article>
      <Slot name="before-content" />
      <PostBody content={post.body} />
      <Slot name="after-content" />
      <Slot name="sidebar" />
    </article>
  )
}
```

```typescript
// プラグイン側: AdSense
export default definePlugin({
  slots: {
    'after-content': (props) => <AdSenseUnit slot="XXXXXXX" />,
  }
})
```

GA スクリプト、AdSense、関連記事ウィジェット等はすべてスロットの仕組みに乗る。
`head` スロットは `<head>` へのスクリプト・メタタグ挿入に使用。

### 用途別テーマ

| テーマ | ターゲット | 説明 |
|--------|-----------|------|
| `@ampless/theme-blog` | 個人/企業ブログ | テキスト主体。シンプル |
| `@ampless/theme-docs` | ドキュメントサイト | サイドバーナビ。Nextra/Docusaurus 風 |
| `@ampless/theme-corporate` | 企業サイト + ブログ | LP + ブログの複合 |

外部のテーマ作者も同じ `defineTheme()` 規約に従えば、管理画面から自動的にインストール・カスタマイズ可能。

### v1 方針
- v0.1: `@ampless/theme-blog` のみ。`configSchema` による CSS 変数カスタマイズ
- v0.2: テーマ切り替え・プレビュー、`@ampless/theme-docs` 追加
- v1.0: eject 対応、外部テーマ対応

---
