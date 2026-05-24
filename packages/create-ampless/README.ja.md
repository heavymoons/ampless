> English: [README.md](./README.md)
> 

# create-ampless

[ampless](https://github.com/heavymoons/ampless) プロジェクト向け CLI スキャフォールディングツール。

> **プレリリース / アルファ版。** v1.0 まではマイナーバージョンでも破壊的変更が入る可能性があります。`@alpha` タグを使用してください（`@latest` タグは v1.0 まで存在しません）。

```bash
npx create-ampless@alpha
```

ウィザードが以下を順に案内します：

1. プロジェクト名
2. サイト名（デフォルトの `<title>` および OGP `siteName` として使用）
3. テーマ — 同梱テーマから選択（例: `blog`）
4. プラグイン — `seo`、`rss`、`webhook`

出力は AWS Amplify Gen 2 バックエンド定義を含む Next.js 16（App Router）プロジェクトです。`/admin` に管理パネル、`/` にパブリックブログが設置され、選択したプラグインが `cms.config.ts` にあらかじめ設定されます。また運用メモ用の `RUNBOOK.md` も生成されます。

## 生成されたプロジェクトでの次のステップ

```bash
cd my-project
npm install
npx ampx sandbox        # AWS 開発リソースをプロビジョニングし amplify_outputs.json を生成
npm run dev             # http://localhost:3000
```

`/login` でサインアップすると、最初に登録したユーザーが自動的に `ampless-admin` Cognito グループに昇格します。

## ワンショットデプロイ：`--deploy`

ウィザードは `npx` から Amplify Hosting の URL まで一気に進めることもできます：

```bash
npx create-ampless@alpha my-site --deploy
```

このフラグを追加すると、スキャフォールディング後に以下が実行されます：

1. `git init` + 初回コミット
2. GitHub リポジトリを作成（`gh repo create`）してプッシュ
3. 新しいリポジトリに紐付けた `aws amplify create-app`
4. `aws amplify create-branch main`
5. `aws amplify start-job --job-type RELEASE`
6. `--domain` を指定した場合はオプションで `aws amplify create-domain-association`

コマンドラインに指定が不足している場合はインタラクティブに確認します。CI 向けのフル指定の例：

```bash
npx create-ampless@alpha my-site --deploy \
  --github-owner my-org \
  --github-private \
  --aws-region us-east-1 \
  --domain example.com --subdomain blog \
  --skip-confirm
```

apex ドメインが同じ AWS アカウントの Route 53 でホストされている場合、ACM の検証が完了すると Amplify が DNS レコードを自動作成します。それ以外の場合、CLI がレジストラで追加すべき正確な CNAME を表示します。

### デプロイの要件

- [`gh`](https://cli.github.com/) のインストールと認証（`gh auth login`）
- [`aws`](https://aws.amazon.com/cli/) のインストールと設定（`aws configure`）
- `repo` スコープを持つ GitHub トークン（`--github-token` → `GITHUB_TOKEN` 環境変数 → `gh auth token` → インタラクティブプロンプトの順で解決）

## 動作要件

- Node.js >= 20
- AWS アカウントと `aws configure` の設定済み（サンドボックス / パイプラインデプロイは AWS に直接アクセスします）

## ライセンス

[MIT](../../LICENSE)
