> English: [THEMES.md](./THEMES.md)
> 

# ampless テーマの作成

ampless におけるテーマは、スキャフォールドされたプロジェクトの `themes/<name>/` 以下に格納される自己完結型のモジュールです。**複数のテーマを同時にインストールできます** — 各サイトがランタイムでアクティブなテーマを選択するため、単一のデプロイで異なるサブドメインを異なるテーマでレンダリングできます。

このドキュメントでは、ディレクトリ構成、マニフェスト、そして新しいテーマの追加方法について説明します。

## 全体像

```
project/
  themes/
    blog/
      index.ts           # デフォルトエクスポート: ThemeModule
      manifest.ts        # デフォルトエクスポート: ThemeManifest
      tokens.css         # [data-theme='blog'] { --primary: ...; ... }
      pages/
        home.tsx
        post.tsx
        tag.tsx
        feed.ts
        sitemap.ts
    minimal/
      ...
  themes-registry.ts     # インストール済みテーマをすべてインポート
  app/
    site/[siteId]/       # 薄いディスパッチャー — アクティブなテーマをレンダリング
      page.tsx
      [slug]/page.tsx
      tag/[tag]/page.tsx
      feed.xml/route.ts
      sitemap.xml/route.ts
    layout.tsx           # <body data-theme={active}> を設定
    globals.css          # デフォルトトークン + Tailwind ベース
    (admin)/             # 管理アプリ — テーマ非依存
  cms.config.ts
  ...
```

## ランタイムモデル

1. ミドルウェアが `https://blog.example.com/some-slug` を `/site/blog/some-slug` に書き換え、`x-site-id: blog` をセットします。
2. ディスパッチャー（`app/site/[siteId]/page.tsx`）が S3 サイト設定キャッシュからその siteId の `theme.active` を読み取ります。
3. アクティブなテーマモジュールを `themes-registry.ts` で検索し、`components.Home` をリクエストパラメーターと共にレンダリングします。
4. ルートレイアウトが `<body data-theme="<active>">` をセットするため、マッチするテーマの `tokens.css` ブロックだけが適用されます。

テーマのサイト別切り替え = 管理画面（または MCP / API 経由）で `theme.active` 設定を更新するだけです。デプロイは不要です。

新しいテーマの追加 = `themes/<name>/` を配置し、`themes-registry.ts` に追加して、再デプロイします。

## どこに何を置くか

| `themes/<name>/` に置くもの | `app/`（共有）に置くもの |
| --- | --- |
| `manifest.ts`（カスタマイズ可能なフィールド） | ディスパッチャールート（`app/site/[siteId]/...`） |
| `tokens.css`（CSS 変数） | デフォルトトークン（`app/globals.css`） |
| `pages/home.tsx` | ルートレイアウト（`app/layout.tsx`） |
| `pages/post.tsx` | 管理アプリ（`app/(admin)/`） |
| `pages/tag.tsx` | 認証ページ（`app/login/`） |
| `pages/feed.ts`（RSS ハンドラー） | API ルート（`app/api/`） |
| `pages/sitemap.ts`（サイトマップハンドラー） | ミドルウェア、プロバイダー |
| `index.ts`（テーマモジュールエントリー） | |

テーマは独自コンポーネントを同梱できます（例：`themes/<name>/components/`）— `pages/` 以下にないものはテーマのプライベートな実装詳細です。

## テーマモジュール（`index.ts`）

すべてのテーマはデフォルトで `ThemeModule` をエクスポートします：

```ts
import { defineThemeModule } from 'ampless'
import './tokens.css'
import manifest from './manifest'
import BlogHome from './pages/home'
import BlogPost, { generatePostMetadata } from './pages/post'
import BlogTag from './pages/tag'
import { blogFeedHandler } from './pages/feed'
import { blogSitemapHandler } from './pages/sitemap'

export default defineThemeModule({
  name: 'blog',
  manifest,
  components: {
    Home: BlogHome,
    Post: BlogPost,
    Tag: BlogTag,
  },
  metadata: {
    Post: generatePostMetadata,
  },
  routes: {
    feed: blogFeedHandler,
    sitemap: blogSitemapHandler,
  },
})
```

`tokens.css` は副作用としてインポートされるため、レジストリがこのモジュールを取り込むたびに Next.js がバンドルします。インストール済み全テーマの CSS がすべてのページに含まれますが、アクティブなテーマの `[data-theme="..."]` セレクターだけがマッチします。

### コンポーネントコントラクト

テーマコンポーネントは非同期サーバーコンポーネントです。`params` の型はディスパッチャールートの形状に合わせます：

```ts
import type { ThemeRouteContext } from 'ampless'

export default async function BlogHome({ params }: ThemeRouteContext) {
  const { siteId } = await params
  // ... 投稿を取得してレンダリング
}

export default async function BlogPost(
  { params }: ThemeRouteContext<{ slug: string }>
) {
  const { siteId, slug } = await params
}
```

`Home` は必須です。`Post` と `Tag` はオプションで、アクティブなテーマで定義されていない場合はディスパッチャーが 404 を返します。

### ルートハンドラー

`routes.feed` と `routes.sitemap` は `{ siteId, request }` を受け取り、`Response` を返す必要があります。省略可能で、ハンドラーがない場合は対応するディスパッチャールートが 404 を返します。

## マニフェスト（`manifest.ts`）

管理 UI がランタイムカスタマイズのために公開するフィールドを宣言します：

```ts
import { defineTheme } from 'ampless'

export default defineTheme({
  name: 'blog',           // テーマディレクトリ名と一致させること
  label: 'Blog',
  description: 'Neutral monochrome with shadcn defaults.',
  fields: [
    {
      key: 'primary',
      label: 'Primary color',
      group: 'Colors',
      type: 'color',
      default: 'oklch(0.205 0 0)',
      cssVar: '--primary',
    },
    // ...
  ],
})
```

各フィールドには以下があります：

- `key` — ストレージキー。サイト設定に `theme.<key>` として保存されます。
- `label`、`description?`、`group?` — 管理 UI のラベル。
- `type` — `color`、`length`、`select`、`image`、`fontFamily`、`text`。
- `default` — オーバーライドが設定されていない場合に使用される値。
- `cssVar?` — 設定されている場合、ローダーがレンダリング時に `:root` に注入します。

タイプごとに受け付けるフォーマットは `ampless` の `validateThemeValue` を参照してください。

### テーマごとのバリエーション

テーマによって宣言するフィールドは異なります。Blog は `primary / accent / radius / bodyFont` を公開し、Minimal は `primary / radius` だけを公開し、ドキュメントテーマは `sidebarWidth / codeFont` を公開するかもしれません。管理フォームはアクティブなテーマから生成されるため、常にそのテーマの実際のカスタマイズ範囲と一致します。

## トークン CSS

各テーマは `[data-theme='<name>']` スコープでデザイントークンを定義した `tokens.css` を同梱します：

```css
[data-theme='blog'] {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --radius: 0.5rem;
  --ampless-body-font: system-ui, sans-serif;
  /* ... */
}

@media (prefers-color-scheme: dark) {
  [data-theme='blog'] {
    --background: oklch(0.145 0 0);
    /* ... */
  }
}
```

共有の `app/globals.css` は同じトークンを `:root` にフォールバックとして定義します。属性セレクターと `:root` セレクターの詳細度は同じですが、属性セレクターがカスケードの後に来るため（テーマの tokens.css のインポートは globals.css の後に続く）、アクティブなテーマのスコープブロックが常に優先されます。

マニフェストフィールドのオーバーライドは、ドキュメントの `<head>` にインライン `<style>:root { ... }</style>` として注入されるため、スコープ付きトークンブロックよりも優先されます。

## 新しいテーマの追加

1. **既存のテーマディレクトリをコピー：**
   ```bash
   cp -R themes/blog themes/your-theme
   ```
2. **`manifest.ts` を書き換える** — `name`、`label`、公開したいフィールドを変更します。
3. **`tokens.css` を編集する** — セレクターを `[data-theme='your-theme']` に変更し、デザイントークンを設定します。
4. **`pages/*.tsx` を編集する** — レイアウトを再デザインします。デフォルトエクスポートの `ThemeRouteContext` 型指定は維持してください。
5. **`themes-registry.ts` を更新する**して新しいテーマをインポートします：
   ```ts
   import yourTheme from '@/themes/your-theme'

   export const themes = {
     blog,
     minimal,
     'your-theme': yourTheme,
   } as const
   ```
6. **テーマを npm tarball に同梱したい場合は `create-ampless` も更新する：**
   - `packages/create-ampless/tsup.config.ts` の `THEMES` に追加。
   - `packages/create-ampless/src/prompts.ts` の `themes` マルチセレクトオプションに追加。
7. **動作確認：**
   ```bash
   npm run dev
   # 管理画面: /admin/sites/<siteId>/theme → your-theme に切り替え
   ```

## ストレージレイアウト

| 設定項目 | ストレージ |
| --- | --- |
| サイトごとのアクティブテーマ | KvStore PK `siteconfig:<siteId>`、SK `theme.active`、値 = テーマ名 |
| マニフェストフィールドのオーバーライド | KvStore PK `siteconfig:<siteId>`、SK `theme.<fieldKey>` |

どちらも既存のサイト設定キャッシュパイプライン（KvStore ストリーム → trusted プロセッサー → `s3://<bucket>/public/site-settings/<siteId>.json`）を経由します。公開サイトはその JSON ファイルを 60 秒の Next.js フェッチキャッシュで読み取ります。管理画面での編集は約 1 分以内に反映されます。

## なぜ統一されたフィールドセットではなく、テーマごとのマニフェストなのか？

テーマによってカスタマイズ可能な範囲が異なります。すべてのテーマに同じフィールドセットを強制すると次のような問題が生じます：

- 無関係なフィールドを無視するテーマ（UI の肥大化）。
- 実際のカスタマイズ項目を公開できないテーマ（UI の貧困）。

マニフェストをテーマに紐付けることで、管理 UI は常にそのテーマが実際にできることを正確に反映します — 過不足なく。

## なぜアクティブなテーマが 1 つでも、インストール済みの全テーマをバンドルするのか？

テーマの切り替えをインスタントにするためです — 設定変更 1 つで、デプロイなしに。各テーマを静的インポートすることで Next.js のバンドラーがすべてを含むため、アクティブなテーマをリビルドなしに変更できます。コストはインストールされているテーマ数に比例したバンドルサイズの増加ですが、メリットはテーマの変更のたびにリビルドが不要になることです。

テーマを使わなくなったら削除してください：`themes/<name>/` を削除し、`themes-registry.ts` のインポートとマップエントリーを削除して、再デプロイします。
