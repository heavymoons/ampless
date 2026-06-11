> English: [quickstart.md](./quickstart.md)
>
# クイックスタート

## 前提条件

- Node.js 22.13 以降（pnpm 11 の動作要件）
- パッケージマネージャー — npm は Node に同梱されておりすぐに使えます。ampless 自体は pnpm で構築されていますが、scaffold したプロジェクトはどちらでも使用できます
- サンドボックスリソースを立てたい AWS アカウントに対して認証済みの AWS CLI — `aws configure`（または AWS CLI が対応している他の認証情報プロバイダー）
- 任意（推奨）: 本番デプロイ時に必要な GitHub CLI の認証済み設定 — `gh auth login`

ampless は AWS Amplify Gen 2 上で完結します — 外部サービスや別途管理するデータベースは不要です。

## スキャフォールドと起動

1. **プロジェクトを生成する**:
   ```bash
   npx create-ampless@beta my-site
   ```
   Amplify Gen 2 バックエンドが組み込まれた `my-site` という名前の Next.js 16（App Router）プロジェクトを作成します。CLI フラグの全一覧は `npx create-ampless@beta --help` で確認できます。

2. **依存関係をインストールする**:
   ```bash
   cd my-site
   npm install
   ```

3. **サンドボックスを起動する**（scaffold 後の `package.json` に `ampx sandbox --once` と `next dev` をチェーンする `sandbox` スクリプトが同梱されています）:
   ```bash
   npm run sandbox       # AWS リソースをプロビジョニング（初回は 10〜20 分）後、http://localhost:3000 を起動
   ```
   `--once` フラグはデプロイが完了した後にサンドボックスを終了させ、Next.js dev サーバーを起動します。バックエンド開発が続く場合は、別のターミナルで `npx ampx sandbox`（ウォッチモード）を、もう一方のターミナルで `npm run dev` を実行してください。

> ampless が beta の間は `@beta` タグを使用してください — `@latest` は最終的な v1.0 リリース用に予約されています。4 段階のリリースパスについては[リリース戦略](./architecture/14-roadmap.ja.md)を参照してください。

## 最初の管理者ユーザー

`http://localhost:3000/login` にアクセスしてサインアップします。最初に登録したユーザーは自動的に `ampless-admin` Cognito グループに昇格します — 別途ブートストラップや招待フローはありません。**2 人目以降のサインアップはデフォルトで Cognito グループなしになります**。管理者が admin UI または AWS Cognito コンソールから手動で昇格させるまでアクセスできません。

⚠️ ampless は `ampless-editor` を信頼済みプリンシパルとして扱います（エディターは投稿本文に HTML / JS を格納できます）。誰かを `ampless-editor` に昇格させる前に、[README](../README.ja.md) の「エディタートラストモデル」セクションを参照してください。

## プロビジョニングされたリソース

`npx ampx sandbox` は `amplify/backend.ts` で定義された Amplify Gen 2 スタックを CloudFormation でプロビジョニングします:

- **Cognito** — `ampless-admin` / `ampless-editor` グループを持つユーザープール + アイデンティティプール
- **DynamoDB** — `Post`、`Page`、`Media`、`Taxonomy`、`PostTag`、`KvStore`、`PluginSecret`、`PluginSecretIndicator`、`McpToken` テーブル
- **S3** — `public/`、`public/media/`、`public/plugins/<instanceId>/` プレフィックスを持つコンテンツバケット
- **AppSync** — パブリック読み取り用のカスタム JS リゾルバーを持つ GraphQL API
- **Lambda** — トラストレベルのプラグインサンドボックス用のイベントプロセッサー関数

すべてご自身の AWS アカウントにプロビジョニングされ、ご自身の請求に計上されます。実験が終わったら `npx ampx sandbox delete` でサンドボックスをクリーンに削除できます。

## 次にやること

- **投稿を書く** — `/admin/posts/new` にログインします。エディターはデフォルトで tiptap を使用し、markdown / HTML / static フォーマットもサポートしています
- **ファーストパーティプラグインをインストールする** — `cms.config.ts` に `seoPlugin()` / `rssPlugin()` / `webhookPlugin()` を追加します。各ケイパビリティについては[プラグイン作者ガイド](../packages/ampless/docs/plugin-author-guide.ja.md)を参照してください
- **本番環境にデプロイする** — サンドボックスプロジェクトを Amplify Hosting にカスタムドメインで公開する準備ができたら、[README](../README.ja.md) の「公開」セクションを参照してください
- **運用** — scaffold したプロジェクトにはユーザー昇格・パスワードリセット・バックアップ / リストア・イベント失敗調査をカバーする `RUNBOOK.ja.md` が同梱されています (英語版は `RUNBOOK.md`)

## さらに詳しく

- [アーキテクチャ概要](./architecture/) — Amplify Gen 2 スタック、プラグインサンドボックス、MCP HTTP トランスポートの設計上の決断
- [プラグイン作者ガイド](../packages/ampless/docs/plugin-author-guide.ja.md) — 独自プラグインを作成する
- [テーマガイド](./THEMES.ja.md) — 外観をカスタマイズするか別のスターターテーマを選ぶ
- [CONTENT.md](./CONTENT.ja.md) — 投稿 / ページ / メディアのデータモデル
