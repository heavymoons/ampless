> English: [09-plugin-distribution.md](./09-plugin-distribution.md)
> 
## 9. プラグインの配布とインストール

### ビルド時インストール（現行モデル）

プラグインは npm パッケージとして配布し、デプロイ時に Lambda の成果物にバンドルする。有効化はプロジェクトの `cms.config.ts` に 1 行：

```bash
pnpm add @ampless/plugin-seo @ampless/plugin-rss
```

```typescript
// cms.config.ts
import { defineConfig } from 'ampless'
import seoPlugin from '@ampless/plugin-seo'
import rssPlugin from '@ampless/plugin-rss'

export default defineConfig({
  site: { name: '...', url: '...' },
  plugins: [
    seoPlugin({ /* ... */ }),
    rssPlugin({ /* ... */ }),
  ],
})
```

その後 `git push` すると Amplify Hosting の自動ビルドが走り、更新後の Lambda がデプロイされる。trusted / untrusted の各 Lambda は `plugins` 配列を自分の `trust_level` でフィルタし、ハンドラ初期化時に該当イベントフックを bind する。

**含意**

- npm の version 管理・lockfile・セキュリティ監査がそのまま使える。
- プラグインの追加・削除はサイト再デプロイを伴う。
- 「管理 UI でクリックしてインストール」は本モデルでは不可能（インストール = コード変更）。

このトレードオフは意図的：ampless のターゲットは「サイト運営者自身がドッグフードする規模のサイト」で、CDK 再デプロイは許容される。代替案（任意 JS をランタイムにロード）はサンドボックス設計の難問になる。

### ファーストパーティプラグイン

本モノレポから出荷し、npm 上で `@ampless/` 配下に公開：

- `@ampless/plugin-seo` — 投稿単位とサイト単位の SEO メタデータ。trusted。
- `@ampless/plugin-rss` — 公開イベント時に `public/plugins/rss/feed.xml` を生成。trusted。
- `@ampless/plugin-og-image` — リクエスト時に OG 画像を動的描画。untrusted（公開 Next.js プロセス内で描画するので AWS データ権限は不要）。
- `@ampless/plugin-webhook` — コンテンツイベントで外向き Webhook を配送。untrusted。
- `@ampless/plugin-analytics-ga4` — Phase 1 の descriptor API で `<head>` に GA4 のスニペットを注入。untrusted（公開 Next.js プロセスで動くので AWS データ権限は不要）。

ファーストパーティ集合はプラグイン拡張ロードマップ ([docs/tmp/plugin-extension-roadmap.md](../tmp/plugin-extension-roadmap.md)) に沿って拡張中。後続も descriptor ベースの head/body 注入 API ([docs/tmp/plugin-extension-spec.md](../tmp/plugin-extension-spec.md)) を使うプラグインを順次追加:

- `@ampless/plugin-gtm` — Google Tag Manager（untrusted、Phase 3）。
- `@ampless/plugin-plausible`、`@ampless/plugin-cookie-consent` 等 — Phase 3 ドッグフード候補。

既存の `seo` / `rss` は Phase 3 で新 capability + descriptor 面に移行する（[docs/tmp/plugin-trust-levels-rfp.md](../tmp/plugin-trust-levels-rfp.md)、未起票）。既存挙動は後方互換のデフォルトとして維持する。

### ランタイム / マーケットプレイス型インストール

管理 UI からの「バンドルをアップロード → S3 に置く → Lambda 実行時にフェッチして実行」というインストールは**未実装**。「trusted 相当の Lambda にランタイムで任意 JS をロードする」サンドボックス設計が未解決の課題で、共有 trusted Lambda 内でやるのは認められず、プラグイン 1 つに Lambda 1 つを割り当てるなら capability ベースの動的 IAM が必要になる。これは[ロードマップ](./14-roadmap.md)項目で、v1.0 のスコープには明示的に含めない。

それまでサードパーティプラグインもファーストパーティと同じ配布形式 — サイト運営者が自分のリポジトリに npm パッケージを追加する — を取る。

---
