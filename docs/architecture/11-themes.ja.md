> English: [11-themes.md](./11-themes.md)
> 
## 11. テーマ

### 設計方針

テーマは公開側のレンダリング全体を担う：ページコンポーネント、メタデータ生成、RSS / sitemap ルート、そして管理 UI に出るカスタマイズ項目。テーマはプロジェクトリポジトリ内のコードとして同梱され、ランタイムにバンドルをインストールする方式ではない。インストール済みテーマ間の切り替えは管理 UI でワンクリック、新しいテーマの**追加**はコード変更。

管理 UI はテーマとは独立した別物（shadcn/ui + Tailwind、テーマ非依存）。ここで「テーマ」と呼ぶのは公開サイトの見た目だけを統括する。

### テーマの構成

テーマは 2 つの値を `index.ts` から export する：

```typescript
// themes/blog/manifest.ts — カスタマイズ可能なフィールド
import { defineTheme } from 'ampless'
export default defineTheme({
  name: 'blog',
  label: { en: 'Blog', ja: 'ブログ' },
  fields: [
    { key: 'primary', type: 'color', default: 'oklch(0.205 0 0)', cssVar: '--primary',
      label: { en: 'Primary color', ja: 'プライマリカラー' } },
    // ...
  ],
})
```

```typescript
// themes/blog/index.ts — ランタイムモジュール
import { defineThemeModule } from 'ampless'
import manifest from './manifest'
import BlogHome from './pages/home'
import BlogPost, { generatePostMetadata } from './pages/post'
import BlogTag from './pages/tag'
import { blogFeedHandler, blogSitemapHandler } from './pages/feed'

export default defineThemeModule({
  name: 'blog',
  manifest,
  components: { Home: BlogHome, Post: BlogPost, Tag: BlogTag },
  metadata: { Post: generatePostMetadata },
  routes: { feed: blogFeedHandler, sitemap: blogSitemapHandler },
})
```

- **`defineTheme()`** はカスタマイズフィールドを定義する。管理 UI がそれからフォームを自動生成し、上書き値を KvStore の `theme.<key>` に保存する。
- **`defineThemeModule()`** は公開 dispatcher が消費する。`Home` は必須、`Post` / `Tag` と `feed` / `sitemap` ルートは任意 — 未提供の面に対しては dispatcher が 404 を返す。

型定義は [`packages/ampless/src/theme.ts`](../../packages/ampless/src/theme.ts)。

### themes-registry

各プロジェクトには `themes-registry.ts`（`create-ampless --upgrade` で再生成される）があり、インストール済みテーマモジュールを全部 import して map と `DEFAULT_THEME` 定数を公開する。`@ampless/runtime` は毎リクエストここから active テーマを解決する。

### active テーマの解決

active テーマ名は KvStore の `theme.active`（`pk='siteconfig', sk='theme.active'`）に保存される。trusted イベントプロセッサが KvStore のサイト設定変更を毎回 `public/site-settings.json` にミラーするので、公開サイトはそこから `theme.active` を読む。

```
管理 UI が KvStore の theme.active を更新（AppSync mutation）
  → DynamoDB Stream → SQS-trusted → processor-trusted
    → public/site-settings.json を再生成
      → 公開サイトが次リクエストで { 'theme.active': 'dads' } を読む
        → resolveActiveTheme() → themes-registry['dads']
```

`resolveActiveTheme()` ([`packages/runtime/src/theme-active.ts`](../../packages/runtime/src/theme-active.ts)) は S3 読み取りを `next.revalidate: 60` でキャッシュしているので、管理側変更は CDK 再デプロイなしで約 60 秒で反映される。registry にないテーマ名 / 欠落は `DEFAULT_THEME` にフォールバックする。

### テーマカスタマイズ

`defineTheme().fields` で使える型：

| `type` | 保存形式 | レンダリング |
|---|---|---|
| `color` | CSS カラー文字列または `light-dark(L, D)` ペア | `:root { --<cssVar>: <value> }` をインライン注入 |
| `length` | `<n><unit>`（px / rem / em / % / vh / vw） | 同上 — CSS 変数 |
| `text` | サニタイズ済み文字列（制御文字と `<>` を削除） | テンプレートが `loadThemeConfig()` 経由で読む |
| `select` / `fontFamily` | 宣言済みオプションのどれか | CSS 変数（fontFamily はテンプレ読み込み） |
| `image` | URL（`javascript:` / `vbscript:` は拒否） | テンプレート読み込み |
| `linkList` | `{ label, url }` の JSON 配列（`tag:<name>` 形式も含む） | テンプレート読み込み。ナビメニュー、フッター、サイドバーグループに使う |

`cssVar` が設定されたフィールドは全公開ページに `:root { ... }` インラインブロックとして埋め込まれる。`cssVar` のないフィールドはテンプレート側が `loadThemeConfig()` で受け取る。検証はサーバサイドで `validateThemeValue` が実施するので、管理フォームからの不正値がページの CSS や `:root` ブロックを壊すことはない。

### テーマ切り替えとプレビュー（管理 UI）

管理画面の Site → Theme で、インストール済みテーマを切り替え、適用前にライブ iframe でプレビューできる。

```
┌────────────────────────────────────────────────┐
│ Site → Theme                                    │
├────────────────┬───────────────────────────────┤
│ インストール済：│  ┌──────────────────────┐    │
│ ● blog (active)│  │  /?previewTheme=dads │    │
│ ○ corporate    │  │  (iframe)            │    │
│ ○ dads         │  └──────────────────────┘    │
│ ○ docs         │                                │
│ ○ landing      │  Customize: primary [■]       │
│ ○ minimal      │             accent  [■]       │
│                │                                │
│                │             [Apply Theme]     │
└────────────────┴───────────────────────────────┘
```

- プレビュー URL：`/?previewTheme=<name>&previewColorScheme=<light|dark>`。middleware がクエリを読んで rewrite 後のリクエストに `x-preview-theme` ヘッダを付け、`resolveActiveTheme()` がそれを honour する。public な訪問者はそのクエリを叩いても、ヘッダ付与は管理画面の iframe コンテキストでのみ起きるため影響しない。
- 「Apply Theme」は `setSiteSetting('theme.active', name)` を呼んだあと、trusted プロセッサが S3 へ伝播し終えるまで `readStoredActiveThemeFresh` で S3 キャッシュをポーリングする — 切り替え後の hard reload がキャッシュ再生成と race しないように。

### キャッシュ

テーマは事前レンダーしない。毎リクエストでテーマのサーバコンポーネントが走り、`metadata.cache` + `cms.config.cache.*` から計算された `Cache-Control` ヘッダ付きでレスポンスする（詳細は [03-content-management.md](./03-content-management.md#キャッシュ戦略)）。繰り返しトラフィックは CDN が吸収し、テーマ Lambda は CDN miss かクールダウン明けにだけ再実行される。

テーマ出力に対する ISR キャッシュはない。テーマ切り替えは S3 上の `theme.active` を書き換えるだけで、次の CDN miss リクエストから新テーマが拾われる。ページ単位のキャッシュ無効化パスは不要。

### スロット / プラグイン注入

テーマは汎用の「slot」挿入点を公開していない。プラグインがページに注入する経路は固定で：

- `siteMetadata` / `metadata` — `<head>` 用のコンテンツ（title、OG、RSS link）。
- `ogImage` — `app/og/[slug]/route.ts` ルートが消費する JSX レンダラを提供。
- `writePublicAsset` — テーマが `<head>` から参照する静的アセット（RSS フィード、sitemap）を書き出す。

特定プラグインの出力を本文中に差し込みたい（例：タイトルと本文の間に AdSense ユニットを入れたい）場合は、テーマコンポーネント側が配置を決める。テーマ非依存の「before-content」スロットのような仕組みはない。

### 現在出荷されているテーマ

6 つすべてが `templates/<theme>/` に住んでおり、`create-ampless` がユーザリポジトリにコピーする。

| ディレクトリ | 用途 |
|---|---|
| `blog` | 個人 / 企業ブログ。ニュートラル系モノクロ。 |
| `corporate` | 企業サイト + ブログ。トップは LP 風、posts セクション付き。 |
| `dads` | デジタル庁デザインシステム（dads Tailwind プラグイン）。公共・公益機関向け。 |
| `docs` | ドキュメント / ハンドブック。サイドバーナビ、タグ別一覧、ディープリンクしやすい。 |
| `landing` | シングルページの LP。投稿はセクションとして出てくる。 |
| `minimal` | ヘッドレス指向のミニマム構成。スタイルがほぼなく、カスタムビルドの土台向け。 |

プロジェクトローカルでテーマをカスタマイズする方法は `templates/_shared/THEMES.md` を参照。

### 管理 UI とテーマ

管理アプリ（`(admin)/admin/*` ルート）は意図的にテーマ非依存。どのテーマが active であっても shadcn/ui + Tailwind のビルドは同じ。管理画面内のサイト furniture（左 rail、トップバー）は `@ampless/runtime/ui` から共有し、テーマ側の site chrome で意味のある部分は同じ実装を使う。テーマが管理画面のスタイルを上書きすることはない。

---
