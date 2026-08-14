> English: [README.md](./README.md)
> 

# ampless

**エンジニアがカスタマイズするための CMS — 非エンジニアはデフォルトのままでも使える。**

AWS Amplify Gen 2 上に構築。エンジニアはテーマ・プラグイン・スキーマを TypeScript で自由にカスタマイズ。編集者はポリッシュされた admin UI で投稿とメディアを管理。MCP ネイティブで Claude / Cursor がコエンジニアとして参加できる。

> **プレリリース / ベータ版。** パッケージは `beta` npm dist-tag で公開しています。ampless は 4 段階のリリースパスを歩んでいます: **alpha**（クローズド dogfood、完了）→ **beta**（リポジトリ公開; npm `beta` dist-tag; 破壊的変更まだあり）→ **RC**（feature-complete、破壊的変更は予定なし）→ **stable**（v1.0）。現在は beta 段階 — GitHub でソースを閲覧でき、外部ユーザーがインストール可能で、API は RC まで変更される可能性があります。

## ampless を選ぶ理由

- **カスタマイズベース。** テーマ・プラグイン・スキーマはすべて TypeScript で。スターターテーマをフォークし、プラグインを npm dep として追加し、React コンポーネントを自由に編集できます。
- **AI ネイティブ（MCP）。** Claude / Cursor / Claude Code が CMS を動かす — 自然言語で投稿執筆・テーマカスタマイズ・プラグイン追加が可能。
- **AWS Amplify Gen 2 上に構築。** 認証は Cognito、コンテンツは DynamoDB、メディアは S3、プラグインは Lambda。自分の AWS アカウント、自分のデータ。
- **編集者向けのポリッシュされた admin。** エンジニアが設定し、編集者が運用。投稿・メディア・設定を非エンジニアにも使いやすく。

## クイックスタート

```bash
npx create-ampless@beta my-site
cd my-site && npm install
npm run sandbox       # AWS 開発リソースをプロビジョニング後、http://localhost:3000 を起動
```

> ampless が beta の間は `@beta` タグを使用してください — `@latest` は最終的な v1.0 リリース用に予約されています。

`/login` でサインアップすると、最初に登録したユーザーが自動的に `ampless-admin` Cognito グループに昇格します。2 人目以降はデフォルトでグループなしとなり、手動で昇格が必要です。**前提条件・プロビジョニングされるリソース・次のステップの詳細**: [quickstart.ja](https://github.com/heavymoons/ampless/wiki/quickstart.ja)

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
| [`create-ampless`](./packages/create-ampless) | `npx create-ampless@beta` — プロジェクトスキャフォールディング |
| [`@ampless/plugin-seo`](./packages/plugin-seo) | OGP / Twitter / canonical メタデータ + `sitemap.xml` |
| [`@ampless/plugin-rss`](./packages/plugin-rss) | RSS 2.0 `/feed.xml` |
| [`@ampless/plugin-webhook`](./packages/plugin-webhook) | 外部 URL への POST イベント通知（HMAC 署名付き） |
| [`@ampless/mcp-server`](./packages/mcp-server) | HTTP MCP transport 経由で接続する MCP tool registry (Claude Desktop / Cursor / Claude Code 等の MCP client から利用) |

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
npx create-ampless@beta --mount \
  --github-owner <your-user-or-org> \
  --aws-region <region> \
  --create-iam-role           # 初回のみ。次回以降は `--iam-service-role <arn>` で使い回し
```

CLI が GitHub repo 作成 (`gh` CLI 認証または `GITHUB_TOKEN` が必要)、Amplify Hosting アプリ作成、GitHub 連携登録、`amplify.yml` ビルド設定、初回デプロイ起動までを一気に実行します。`--domain` / `--subdomain` を渡すと同じ流れの中でカスタムドメインもバインドされます。`--skip-confirm` で CI フレンドリーな非対話モードに。フラグ全体は `npx create-ampless@beta --help` で確認できます。

**手動 (コンソール).** `git init && git push` で自前の repo に上げてから、**AWS Amplify Hosting コンソール → Create new app → Host web app → repo 連携 → デプロイ**。詳細手順は scaffold 後のプロジェクトの `README.ja.md`（「本番デプロイ」セクション）と `RUNBOOK.ja.md` に。

いずれも初回デプロイは 10〜20 分（CloudFormation で Cognito / DynamoDB / S3 / AppSync / Lambda を provision）。以降は接続ブランチへの push で自動再デプロイ。

CLI フローの前提条件: [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) (`aws configure`) と [GitHub CLI](https://cli.github.com/) (`gh auth login`) を認証済みにしておくか、`--github-token` を直接渡すこと。詳細は scaffold 後のプロジェクトの `README.ja.md` (「必要なもの」+「本番デプロイ」セクション) に。

## プラグインを書く

自分でプラグインを書きたい場合は、実装ハンドブック
[`packages/ampless/docs/plugin-author-guide.ja.md`](./packages/ampless/docs/plugin-author-guide.ja.md)
を参照してください (英語版は `plugin-author-guide.md`)。同じファイルは
`ampless` の npm tarball に同梱され、scaffold したサイトリポジトリの
`docs/plugin-author-guide.ja.md` にもコピーされるので、外部の作者は
このレポを clone せずに読めます。

Phase 1 + Phase 2 のサーフェスを網羅しています — descriptor ベースの
head / body 注入、`ctx.setting<T>()` 経由の admin 管理
`settings.public` 値、非同期イベントフック、3 段階の trust level、
npm 公開。GA4 / RSS / SEO / Webhook の同梱プラグインが参照する動作
サンプルです。

設計の経緯は [`architecture-08-plugin-architecture.ja`](https://github.com/heavymoons/ampless/wiki/architecture-08-plugin-architecture.ja)
に集約。作者ガイド側は何をどこに書くかにフォーカスしています。

## エディタートラストモデル（`editor` 権限を付与する前に必ずお読みください）

ampless は `ampless-editor` を信頼済みプリンシパルとして扱います — WordPress の `unfiltered_html` ケイパビリティと同じ位置づけです。エディターは投稿本文に任意の HTML / JavaScript を格納でき、公開サイトはそれをそのままレンダリングします。詳細な仕様は [`architecture-04-access-layer-mcp`](https://github.com/heavymoons/ampless/wiki/architecture-04-access-layer-mcp) を参照してください。要約すると、**`admin` を付与してもよいと思える相手にのみ `editor` を付与してください**。

## ロードマップ

ampless の開発は 4 段階のリリースパスに従っています: **alpha → beta → RC → stable**。現在は beta 段階 — リポジトリは公開され、npm パッケージは `beta` dist-tag で公開中で、RC までは破壊的変更がまだあり得ます。**Alpha** はクローズド dogfood 期間でした。**RC** は feature-complete で破壊的変更なしのフェーズ。**v1.0 stable** は ampless の紹介ページ（ampless 自身で構築）と同時ローンチ。ampless はエンジニア向けのカスタマイズベース CMS として位置づけられており、プラグインはサイトエンジニアが審査してインストールする npm dep です。未審査のサードパーティプラグインを安全に動かすためのマーケットプレイス + ランタイムサンドボックスは v2.0+ の探索項目であり、コミット済みの v2.0 成果物ではありません。

| フェーズ | ハイライト |
|---|---|
| v0.1（完了 — 内部） | CLI、管理パネル、ブログテンプレート、Cognito、MCP サーバー、SEO / RSS / Webhook プラグイン |
| v0.x（進行中） | テーマカスタマイズ、MCP HTTP トランスポート + アクセストークン、CloudFront キャッシュ戦略、AI プロバイダー抽象化、WXR インポート、モニタリング改善 |
| **Beta（現在の公開プレリリース）** | リポジトリは公開、npm `beta` dist-tag、破壊的変更はまだあり得る。外部プラグイン作者は npm にプラグインを publish 可能（`cms.config.ts` での静的読み込み）、外部ユーザはソース閲覧可で install 可能 |
| v1.0 RC | feature-complete、破壊的変更は予定なし。ファーストパーティサイトは RC ビルドで運用 |
| v1.0 stable | 公開ローンチ — ampless 自身のマーケティングページ（ampless 製）も同時にローンチ |
| v2.0+ | 探索のみ — ampless がプラグインマーケットプレイスを必要とする場合: ランタイムサンドボックス、動的 IAM、配布 UI。v1.0 のコミットではない |

詳細なリストは [`architecture-14-roadmap`](https://github.com/heavymoons/ampless/wiki/architecture-14-roadmap) を参照してください。

## アーキテクチャ

[`docs/architecture/`](https://github.com/heavymoons/ampless/wiki/Home#architecture) に懸案事項ごとに分割された設計ドキュメントがあります。[`ARCHITECTURE.md`](./ARCHITECTURE.md) が目次です。

## コントリビューション

[CONTRIBUTING.ja.md](./CONTRIBUTING.ja.md) を参照してください。

## ライセンス

[MIT](./LICENSE)
