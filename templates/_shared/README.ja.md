> English: [README.md](./README.md)
> 
# {{siteName}}

このサイトは [ampless](https://github.com/heavymoons/ampless) で構築されています — AWS Amplify Gen 2（Cognito + DynamoDB + S3 + AppSync + Lambda）上で動くサーバーレス CMS、フロントエンドは Next.js 16。

この README は、サイト運営者として日常的に知っておくべき内容をまとめたものです。たまにやる運用手順（API キーのローテーション、バックアップ復元など）は [RUNBOOK.ja.md](./RUNBOOK.ja.md) に置いています。テーマごとのカスタマイズ詳細は `themes/<name>/README.ja.md` を参照してください。

このプロジェクトで AI コーディングエージェント（Claude Code, Cursor, Codex など）を使うなら [AGENTS.ja.md](./AGENTS.ja.md) を読ませてください。エージェントが触っていい場所・ダメな場所がそこに書いてあります。

## 必要なもの

- **Node.js 22+** と **npm**。
- **AWS アカウント.** [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) をインストールしてから `aws configure` で認証情報とデフォルトリージョンを設定します。sandbox / 本番ともに実 AWS リソースをデプロイします。
- **GitHub アカウント** — AWS Amplify Hosting 経由の本番デプロイで必要。下記の [CLI デプロイフロー](#方法-1-cli-ワンショット推奨) を使う場合は [`gh` CLI](https://cli.github.com/) を `gh auth login` で認証する（または `repo` スコープ付きの `GITHUB_TOKEN` 環境変数を設定する）必要があります。コンソール経由の手動フローには `gh` は不要です。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm install` | 依存関係をインストール |
| `npm run sandbox` | 個人用 AWS サンドボックス（Cognito / DynamoDB / S3 など）をプロビジョニング、`amplify_outputs.json` を再生成し、`next dev` を `http://localhost:3000` で起動 |
| `npm run dev` | Next.js だけを起動（サンドボックスのプロビジョニングはスキップ — 一度 `sandbox` を実行済みなら使える） |
| `npm run build` | Next.js アプリの本番ビルド（Amplify Hosting のデプロイでも自動実行される） |
| `npm run start` | ビルド済みアプリをローカルで配信 |
| `npm run lint` | `next lint` で lint |
| `npm run update-ampless` | ampless テンプレートの最新ファイルを取り込む（設定やテーマは保持。下記「ampless の更新」参照） |
| `npm run copy-theme` | 公式テーマを後から追加する |

## 初回セットアップ

```bash
npm install
npm run sandbox
```

初回 sandbox は 5〜10 分かかります（AWS リソースのプロビジョニング）。`next dev` 起動前に毎回 `amplify_outputs.json` が再生成されます。

[http://localhost:3000/login](http://localhost:3000/login) を開き、**Create admin account** をクリック。最初に登録したユーザーが自動的に `ampless-admin` Cognito グループに追加されます。

## 管理画面

サインイン後、管理画面は `/admin`:

| パス | 役割 |
| --- | --- |
| `/admin` | ダッシュボード |
| `/admin/posts` | 投稿の一覧 / 作成 / 編集（Tiptap、Markdown、生 HTML、または zip アップロードの静的バンドル） |
| `/admin/media` | 画像 / 動画 / ファイルを S3 にアップロード |
| `/admin/sites/<siteId>` | サイトレベル設定（名前、URL） |
| `/admin/sites/<siteId>/theme` | テーマの切り替え + フィールド調整（カラー、フォント、ナビ、ロゴなど） |
| `/admin/users` | ユーザー一覧と Cognito グループ所属の確認 |
| `/admin/mcp-tokens` | HTTP MCP エンドポイント用の Bearer トークンを発行 |

ユーザーロール（Cognito グループ）:

- `ampless-admin` — フルアクセス（コンテンツ + 運用 + 破壊的操作）
- `ampless-editor` — コンテンツの CRUD（破壊的操作はなし）
- `ampless-reader` — 将来の REST/MCP API クライアント用に予約

ロールの付与 / 取り消しは AWS Cognito コンソールで行います — [RUNBOOK.ja.md → ユーザーの昇格 / 降格](./RUNBOOK.ja.md#promote--demote-a-user) を参照。

## コンテンツの執筆

投稿（Post）が唯一のコンテンツタイプです。各投稿には以下があります:

- **Format** — `tiptap`（リッチテキスト）/ `markdown` / `html`（生 HTML、サニタイズなし）/ `static`（HTML/CSS/JS の zip アップロード）
- **No layout** フラグ（`format: 'html'` のときのみ）— 本文をそのまま出力し、Next.js のレイアウトもテーマのクロームも適用しない。URL は `/<slug>` のままで、middleware がリクエストを内部のベア HTML ハンドラーに書き換える
- **キャッシュ戦略**（`metadata.cache`）— 投稿ごとに `Cache-Control` を上書き: `'auto'`（デフォルト、編集時刻ベースのクールダウン）、`'deep'`（常に長期キャッシュ）、`'hot'`（常に no-store）。詳細は `docs/CONTENT.ja.md`
- **Slug** — 公開 URL
- **Status** — `draft`（管理者のみ）または `published`

詳細リファレンス: [docs/CONTENT.ja.md（GitHub）](https://github.com/heavymoons/ampless/blob/main/docs/CONTENT.ja.md) ([English](https://github.com/heavymoons/ampless/blob/main/docs/CONTENT.md))

## テーマ

インストール済みのテーマはすべて `themes/<name>/` にバンドルされています。**アクティブな**テーマはサイトごとのランタイム設定 — テーマの切り替えに**再デプロイは不要**です。

アクティブテーマの切り替え: `/admin/sites/<siteId>/theme` → インストール済みリストから選択 → 保存。

アクティブテーマのカスタマイズ（カラー、フォント、ヘッダー / フッターナビなど）: 同じ画面 — 各テーマが固有のカスタマイズフィールドを公開しています。各テーマで何が変えられるかは `themes/<name>/README.ja.md` を参照。

このプロジェクトに別の公式テーマを追加する:

```bash
npm run copy-theme
```

独自テーマを作る場合: 既存テーマをコピーから始める（`cp -R themes/blog themes/your-theme`）→ `manifest.ts`、`tokens.css`、`pages/*.tsx` を編集 → `themes-registry.ts` に追加。フルガイド: [docs/THEMES.ja.md](https://github.com/heavymoons/ampless/blob/main/docs/THEMES.ja.md) ([English](https://github.com/heavymoons/ampless/blob/main/docs/THEMES.md))

## プラグイン

プラグインは CMS にイベント駆動の副作用（SEO メタデータ、RSS フィード、外部 URL への webhook、OG 画像生成など）を追加する仕組みです。[`cms.config.ts`](./cms.config.ts) で宣言し、投稿の publish / update / delete 時に Lambda 上で実行されます。

`cms.config.ts` に書けば有効になる、同梱の公式プラグイン:

| パッケージ | 役割 |
| --- | --- |
| `@ampless/plugin-seo` | 投稿ごとの OGP / Twitter / canonical メタデータ + `sitemap.xml` |
| `@ampless/plugin-rss` | `/feed.xml` の RSS 2.0 フィード |
| `@ampless/plugin-webhook` | 外部 URL へのイベント POST（HMAC 署名付き） |
| `@ampless/plugin-og-image` | `/og/<slug>` での動的 OG 画像生成 |

プラグインを追加するには: install（`npm i @ampless/plugin-...`）→ `cms.config.ts` で import → `plugins` 配列に追加:

```ts
import seoPlugin from '@ampless/plugin-seo'
import rssPlugin from '@ampless/plugin-rss'

export default defineConfig({
  // ...
  plugins: [
    seoPlugin({ twitterSite: '@example' }),
    rssPlugin({ language: 'ja', limit: 20 }),
  ],
})
```

プラグイン変更には再デプロイが必要です（プラグインコードは Lambda バンドルに含まれます）。

## 本番デプロイ

同梱の [`amplify.yml`](./amplify.yml) が、connect したブランチへの push のたびに `npx ampx pipeline-deploy`（Amplify バックエンド） + `npm run build`（Next.js）を実行します。

### 方法 1: CLI ワンショット（推奨）

このプロジェクトディレクトリ内で:

```bash
npx create-ampless@latest --mount \
  --github-owner <your-user-or-org> \
  --aws-region <region> \
  --create-iam-role           # 初回のみ。次回以降は `--iam-service-role <arn>` で使い回し
```

CLI が以下を一気に実行します:

1. GitHub repo を作成（認証済みの `gh` CLI、`GITHUB_TOKEN` 環境変数、または `--github-token` フラグを利用）
2. プロジェクトを repo に push
3. Amplify Hosting アプリ + ブランチ作成、GitHub 連携登録、`amplify.yml` ビルド spec 配置
4. 初回デプロイ起動

便利な追加フラグ:

- `--github-private` — private repo を作成（デフォルト: public）
- `--domain <name>` `--subdomain <prefix>` — 同じ流れの中でカスタムドメインをバインド
- `--skip-confirm` — 非対話モード（CI / 再実行向け）
- `--aws-profile <name>` — 複数 AWS profile がある場合に明示

全フラグは `npx create-ampless@latest --help` を参照。

**このフロー固有の事前準備（[トップの必要なもの](#必要なもの) に加えて）:**

| | 用途 | 準備方法 |
|---|---|---|
| `aws` CLI 認証済み | Amplify Hosting アプリ + サービスロールの provision | [インストール](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) して `aws configure` を実行（または `aws sso login`）。`aws sts get-caller-identity` で確認。 |
| `gh` CLI 認証済み **または** `GITHUB_TOKEN` env | GitHub repo を作成して初回コミットを push | [`gh` をインストール](https://cli.github.com/) して `gh auth login` を実行、**または** `repo` スコープ付きの [personal access token](https://github.com/settings/tokens) を `GITHUB_TOKEN` として export。`--github-token <token>` を直接渡す場合は不要。 |
| Amplify Hosting 用 IAM service role | Amplify が代理で backend リソースをデプロイするのに必要 | `--create-iam-role` を渡せば CLI が `AmplifyDeployBackend`（idempotent）を provision。または `--iam-service-role <arn>` で既存ロールを再利用。ロールは `amplify.amazonaws.com` を trust し、`AdministratorAccess-Amplify` を attach している必要があります。 |

### 方法 2: コンソール（手動）

1. **GitHub（または Amplify Hosting が対応する git ホスト）にこのプロジェクトを push**:
   ```bash
   git init && git add . && git commit -m "init"
   git remote add origin <your-repo>
   git push -u origin main
   ```
2. **AWS Amplify Hosting コンソール** → **Create new app** → **Host web app** → リポジトリを連携 → ブランチを選択 → 自動検出されたビルド設定（`amplify.yml` の内容になっているはず）を確認 → デプロイ
3. 初回デプロイは 10〜20 分。以降は連携ブランチへの push で自動再デプロイ

### 環境変数

環境ごとの値は **Amplify Hosting コンソール → Hosting → Environment variables** で設定。よく使うもの:

| 変数 | 利用箇所 |
| --- | --- |
| `WEBHOOK_SECRET` | `@ampless/plugin-webhook` の HMAC 署名 |

env 変数追加 / 変更後は再デプロイをトリガーしてください。

### カスタムドメイン

Amplify Hosting アプリの **Domain management** からドメインをバインドします — ACM 証明書と DNS レコードは Amplify が自動でプロビジョニングします。詳細手順: [RUNBOOK.ja.md → カスタムドメインを Amplify Hosting に追加](./RUNBOOK.ja.md#adding-a-custom-domain-to-amplify-hosting)

## AI 連携（MCP）

ampless は MCP（Model Context Protocol）サーバーを同梱しているので、Claude Desktop / Cursor / Claude Code など MCP に対応した AI クライアントから投稿の読み書きができます。

- **ローカル / sandbox** — グローバルに 1 度入れる: `npx -y @ampless/mcp-server@alpha` に `amplify_outputs.json` のパスを渡す

## ampless の更新

ampless は `alpha` dist-tag でリリースしています。新機能を取り込むには:

```bash
npm run update-ampless
```

これは `npx create-ampless@latest upgrade` を実行し、以下を行います:

- `package.json` の `@ampless/*` / `ampless` 依存をバージョンアップ
- 共有テンプレートファイル（admin アプリの土台、amplify バックエンド、lib/、middleware、テーマ）を再同期 — `cms.config.ts`、`theme.*` 管理画面設定、投稿、テーマ manifest 値などのユーザーカスタマイズは保持されます
- `update-ampless` / `copy-theme` スクリプトのコマンドが変わっていれば更新

commit 前に diff を確認できます。

## 運用

日常以外の運用レシピ — ユーザー昇格、パスワードリセット、バックアップ復元、カスタムドメイン配線、AppSync API キーローテーション — は [RUNBOOK.ja.md](./RUNBOOK.ja.md) にあります。

## ライセンス

このプロジェクト自身のコードはあなたのものです。ampless 本体は MIT ライセンスです。詳細は [ampless リポジトリ](https://github.com/heavymoons/ampless) を参照。
