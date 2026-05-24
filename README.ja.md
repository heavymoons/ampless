> English: [README.md](./README.md)
> 

# ampless

**AWS Amplify 向けのサーバーレス CMS。**「AWS ネイティブ版 EmDash」。

> **プレリリース / アルファ版。** 全パッケージは `alpha` npm dist-tag (`0.x-alpha.y` semver) で公開しています。v1.0 RC までは、マイナーバージョンでも破壊的変更が入る可能性があります。リポジトリは v1.0 RC まで非公開ですが、npm パッケージはインストール可能です（GitHub でソースは閲覧できません）。

## ampless を選ぶ理由

- **AWS ネイティブ。** Amplify Gen 2 上で完結します — 認証は Cognito、コンテンツは DynamoDB、メディアは S3、プラグインは Lambda、クエリは AppSync。余計な可動部分は一切ありません。
- **AI ファースト。** MCP サーバー（`@ampless/mcp-server`）を使えば、Claude Desktop・Cursor・Claude Code など MCP 対応のあらゆるツールから投稿を直接読み書きできます。
- **プラグインフレンドリー。** トラストレベルで分離された Lambda（`untrusted` / `trusted`）がイベントフックを実行するため、全プラグインがデータにアクセスできる状態にはなりません。
- **TypeScript ファースト。** `cms.config.ts` からイベントハンドラまで、すべてがエンドツーエンドで型付けされています。

## クイックスタート

```bash
npx create-ampless@alpha my-site
```

CLI が Next.js 16（App Router）プロジェクトを生成します。その後：

```bash
cd my-site
npm install
npx ampx sandbox      # AWS 開発リソースをプロビジョニングし amplify_outputs.json を生成
npm run dev           # http://localhost:3000
```

> `@alpha` タグを使用してください — `@latest` は最終的な v1.0 リリース用に予約されています。

`/login` でサインアップすると、最初に登録したユーザーが自動的に `ampless-admin` Cognito グループに昇格します。

公開準備ができたら、CLI の `--mount` モードで「ローカルで作業中のディレクトリ」を GitHub repo + Amplify Hosting アプリに一括登録できます。下記 [公開](#公開) セクション参照。

## スタック

| レイヤー | 技術 |
|---|---|
| フロントエンド | Next.js 16 App Router |
| UI | shadcn/ui + Tailwind v4 |
| エディタ | tiptap（画像・リンク拡張あり） |
| バックエンド | AWS Amplify Gen 2（CDK ベース） |
| 認証 | Cognito（ユーザープール + アイデンティティプール） |
| データ | DynamoDB |
| メディア | S3（public/private プレフィックス、署名付き URL またはダイレクト配信） |
| API | AppSync GraphQL（パブリック読み取りはカスタム JS リゾルバー） |
| プラグイン | Lambda 関数、トラストレベルで分離、DynamoDB Streams → SQS 経由でフィード |

## パッケージ

| パッケージ | 用途 |
|---|---|
| [`ampless`](./packages/ampless) | コア型定義、プラグインコントラクト、共通ユーティリティ |
| [`create-ampless`](./packages/create-ampless) | `npx create-ampless@latest` — プロジェクトスキャフォールディング |
| [`@ampless/plugin-seo`](./packages/plugin-seo) | OGP / Twitter / canonical メタデータ + `sitemap.xml` |
| [`@ampless/plugin-rss`](./packages/plugin-rss) | RSS 2.0 `/feed.xml` |
| [`@ampless/plugin-webhook`](./packages/plugin-webhook) | 外部 URL への POST イベント通知（HMAC 署名付き） |
| [`@ampless/mcp-server`](./packages/mcp-server) | Claude Desktop / Cursor / Claude Code 向け MCP サーバー |

## `cms.config.ts` でのプラグイン設定

```ts
import { defineConfig } from 'ampless'
import seoPlugin from '@ampless/plugin-seo'
import rssPlugin from '@ampless/plugin-rss'
import webhookPlugin from '@ampless/plugin-webhook'

export default defineConfig({
  site: { name: 'My Blog', url: 'https://example.com' },
  plugins: [
    seoPlugin({ twitterSite: '@example' }),
    rssPlugin({ language: 'en', limit: 20 }),
    webhookPlugin({
      endpoints: [{ url: 'https://example.com/hooks/ampless', secret: process.env.WEBHOOK_SECRET }],
    }),
  ],
})
```

## 公開

ローカルで scaffold して sandbox 動作確認まで終わったら、GitHub に push して Amplify Hosting に接続します。2 通りの経路があります:

**CLI (`--mount`, 推奨).** プロジェクトディレクトリ内で:

```bash
npx create-ampless@latest --mount \
  --github-owner <your-user-or-org> \
  --aws-region <region> \
  --create-iam-role           # 初回のみ。次回以降は `--iam-service-role <arn>` で使い回し
```

CLI が GitHub repo 作成 (`gh` CLI 認証または `GITHUB_TOKEN` が必要)、Amplify Hosting アプリ作成、GitHub 連携登録、`amplify.yml` ビルド設定、初回デプロイ起動までを一気に実行します。`--domain` / `--subdomain` を渡すと同じ流れの中でカスタムドメインもバインドされます。`--skip-confirm` で CI フレンドリーな非対話モードに。フラグ全体は `npx create-ampless@latest --help` で確認できます。

**手動 (コンソール).** `git init && git push` で自前の repo に上げてから、**AWS Amplify Hosting コンソール → Create new app → Host web app → repo 連携 → デプロイ**。詳細手順は scaffold 後のプロジェクトの `README.ja.md`（「本番デプロイ」セクション）と `RUNBOOK.ja.md` に。

いずれも初回デプロイは 10〜20 分（CloudFormation で Cognito / DynamoDB / S3 / AppSync / Lambda を provision）。以降は接続ブランチへの push で自動再デプロイ。

## エディタートラストモデル（`editor` 権限を付与する前に必ずお読みください）

ampless は `ampless-editor` を信頼済みプリンシパルとして扱います — WordPress の `unfiltered_html` ケイパビリティと同じ位置づけです。エディターは投稿本文に任意の HTML / JavaScript を格納でき、公開サイトはそれをそのままレンダリングします。詳細な仕様は [`docs/architecture/04-access-layer-mcp.md`](./docs/architecture/04-access-layer-mcp.md) を参照してください。要約すると、**`admin` を付与してもよいと思える相手にのみ `editor` を付与してください**。

## ロードマップ

ampless は将来的にオープンに開発される予定ですが、**リポジトリは v1.0 RC まで非公開**です。メンテナー自身の複数サイトで運用するのに十分な品質になり、プロジェクト自体のマーケティングページが ampless で構築された段階でパブリックリリースします。

| フェーズ | ハイライト |
|---|---|
| v0.1（完了 — 内部） | CLI、管理パネル、ブログテンプレート、Cognito、MCP サーバー、SEO / RSS / Webhook プラグイン |
| v0.x（進行中） | テーマカスタマイズ、MCP HTTP トランスポート + アクセストークン、CloudFront キャッシュ戦略、AI プロバイダー抽象化、WXR インポート、モニタリング改善 |
| v1.0 RC（パブリック化のトリガー） | コア + ファーストパーティプラグインで実際のサイトを運用できる状態、ampless 自身のマーケティングページが存在する |
| v1.0 stable | 管理画面の改善、カスタムコンテンツタイプ、REST API、イジェクト |
| v2.0+ | サードパーティプラグイン、マーケットプレイス、WASM サンドボックス |

詳細なリストは [`docs/architecture/14-roadmap.md`](./docs/architecture/14-roadmap.md) を参照してください。

## アーキテクチャ

[`docs/architecture/`](./docs/architecture/) に懸案事項ごとに分割された設計ドキュメントがあります。[`ARCHITECTURE.md`](./ARCHITECTURE.md) が目次です。

## コントリビューション

[CONTRIBUTING.ja.md](./CONTRIBUTING.ja.md) を参照してください。

## ライセンス

[MIT](./LICENSE)
