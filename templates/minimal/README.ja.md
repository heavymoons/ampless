> English: [README.md](./README.md)
> 

# {{siteName}}

[ampless](https://github.com/heavymoons/ampless) で構築したブログサイトです。**Minimal** テーマを使用しています — shadcn/ui のカラートークンをベースにした、温かみのあるニュートラル背景にソフトブルーのアクセントが特徴です。

## はじめに

このプロジェクトはバックエンドに Amplify Gen 2（Cognito、DynamoDB、S3）、フロントエンドに Next.js を使用しています。

```bash
# 1. 依存パッケージをインストール
npm install

# 2. 個人用 AWS サンドボックスをデプロイし、Next.js 開発サーバーを起動します。
#    AWS 認証情報の設定が必要です（`aws configure`）。
#    初回実行時はリソースのプロビジョニングに約 5〜10 分かかります。
#    amplify_outputs.json は開発サーバー起動前に毎回再生成されます。
npm run sandbox
```

起動後、[http://localhost:3000](http://localhost:3000) を開いてください。

## 最初の管理者ユーザー

[http://localhost:3000/login](http://localhost:3000/login) を開き、**管理者アカウントを作成** をクリックしてください。最初に登録したユーザーが自動的に `ampless-admin` Cognito グループに追加されます。

その後、`/admin` からコンテンツを管理できます：

- `/admin` — ダッシュボード
- `/admin/posts` — 投稿の一覧 / 作成 / 編集（tiptap エディター）
- `/admin/media` — S3 への画像アップロード

## 本番デプロイ

```bash
git init && git add . && git commit -m "init"
git remote add origin <リポジトリ URL>
git push
# その後、AWS コンソールで AWS Amplify Hosting にリポジトリを接続します。
```

## カスタマイズ

- `cms.config.ts` — サイト名、メディア配信モード、プラグイン
- `app/` — Next.js App Router のページ（`(public)/` がブログ、`(admin)/` が CMS）
- `amplify/` — Amplify Gen 2 バックエンド定義（認証 / データ / ストレージ）

## プラグイン

有効: {{plugins}}
