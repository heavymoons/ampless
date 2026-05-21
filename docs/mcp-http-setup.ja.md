> English: [mcp-http-setup.md](./mcp-http-setup.md)
> 

# MCP HTTP セットアップ

HTTP MCP エンドポイントをセットアップして、AI クライアント（Claude Desktop、Cursor、Claude Code、その他 MCP 対応ツール）がネットワーク経由で本番環境の ampless サイトを読み書きできるようにします — ローカルの `amplify_outputs.json` は不要です。

エンドポイントは `https://<your-domain>/api/mcp` にマウントされ、`/admin/mcp-tokens` で発行された Bearer トークンで認証します。

## 初回セットアップ（サイトごとに 1 回）

ampless の HTTP MCP ルートは Next.js の SSR Lambda 内で動作します。AppSync への呼び出しには Cognito ID トークンが必要なため、このルートは一度だけプロビジョニングする専用の **サービス Cognito ユーザー** としてサインインします。

### 1. サービスユーザーを作成する

管理 UI で：

1. 管理者としてサインインします。
2. `/admin/users` を開き、新しいアカウントを作成します（例：`mcp-service@<your-domain>`）。
3. **強力な**ランダムパスワードを設定します（MCP ルートのみが使用するため、再度入力する必要はありません）。
4. ユーザーを `admin` グループに昇格させます。

> ヒント：このアカウントでは Cognito コンソールで MFA を無効化できます — MCP ルートはユーザー名 / パスワード SRP 認証を使用しており、MFA チャレンジには対応していません。

### 2. 環境変数を設定する

Amplify Hosting コンソールのアプリ設定で：

- **Hosting → Environment variables** を開きます。
- 以下を追加します：
  - `AMPLESS_MCP_SERVICE_EMAIL` — サービスユーザーのメールアドレス
  - `AMPLESS_MCP_SERVICE_PASSWORD` — 手順 1 で設定したパスワード
- 再デプロイをトリガーして、SSR Lambda が新しい環境変数を取得できるようにします。

> Amplify Hosting は環境変数を保存時に暗号化します。あなたの AWS アカウントからのみ参照できます。

### 3. MCP アクセストークンを発行する

再デプロイが完了したら：

1. 管理 UI で `/admin/mcp-tokens` を開きます（admin ロール必須）。
2. **Generate token** をクリックし、使用する場所を識別できるラベルを付けます（例：`Claude Desktop — laptop`）。
3. ロールを選択します：
   - `admin` — `delete_post` を含むすべてのツール。
   - `editor` — 破壊的操作を除くすべてのツール。
4. 平文のトークンが **1 度だけ** 表示されます。すぐに MCP クライアントの設定にコピーしてください。

トークンを紛失した場合は、同じページから失効させて新しいものを発行してください — 平文は設計上、復元できません。

## クライアント設定

### Claude Desktop / Claude Code

`~/Library/Application Support/Claude/claude_desktop_config.json`（macOS；その他のプラットフォームは Anthropic のドキュメントを参照）を編集して以下を追加します：

```json
{
  "mcpServers": {
    "ampless-prod": {
      "url": "https://<your-domain>/api/mcp",
      "headers": {
        "Authorization": "Bearer amp_mcp_<token>"
      }
    }
  }
}
```

Claude Desktop を再起動します。接続が「Connected」と表示され、6 つのツールが公開されます。

### Cursor / その他

URL とカスタムヘッダーを受け付ける MCP クライアントであれば同様に動作します。ワイヤープロトコルは POST 上の JSON-RPC 2.0 です。

## 利用可能なツール

| ツール | 説明 | 必要なロール |
|---|---|---|
| `list_posts` | ステータスフィルター + ページネーション付きで投稿一覧を取得 | editor |
| `get_post` | スラグまたは postId で投稿を取得 | editor |
| `create_post` | 新しい投稿を作成（下書きまたは公開） | editor |
| `update_post` | 既存の投稿のフィールドをパッチ | editor |
| `delete_post` | 投稿（およびそのタグインデックスエントリー）を削除 | **admin** |
| `get_schema` | CMS コンテンツスキーマを返す | editor |

stdio CLI の `upload_media` は今リリースでは HTTP 経由では**利用できません** — SSR Lambda はメディアバケットへの直接 `s3:PutObject` 権限を持っておらず、Amplify Hosting のマネージドコンピューティングモデルをまたいでそれを付与することは、後続リリースへの課題としています。現時点ではメディアのアップロードには管理 UI を使用してください。

## 監査ログ

AppSync および S3 の監査ログ（CloudTrail）では、MCP 経由のすべての呼び出しが共有のサービス Cognito ユーザーとして記録されます — AWS レイヤーではトークンを区別できません。トークン単位のアトリビューションは、SSR Lambda 自身の CloudWatch Logs に `/api/mcp` から出力される 1 行 JSON イベントとして残ります:

```
{ "event": "mcp.tool_call", "tokenLabel": "Claude Desktop", "tokenRole": "admin",
  "tool": "create_post", "argKeys": ["title", "slug", "body"], "ts": "..." }
{ "event": "mcp.tool_ok", "tokenLabel": "Claude Desktop",
  "tool": "create_post", "durationMs": 234, "ts": "..." }
```

イベント種別: `mcp.auth_failed | mcp.tool_call | mcp.tool_ok | mcp.tool_failed | mcp.tool_unsupported | mcp.role_denied | mcp.tool_unknown`。トークンのプレーンテキストは**決してログに残しません** — フォレンジック検索用に 12 文字の `tokenHashPrefix` のみが残ります。

CloudWatch Logs Insights のクエリ例（ロググループは自分のアプリの SSR Lambda に置き換えてください）:

```
fields @timestamp, event, tokenLabel, tool, durationMs, error
| filter event like /mcp\./
| sort @timestamp desc
| limit 200
```

## トラブルシューティング

### "AMPLESS_MCP_SERVICE_EMAIL env vars are required"

Lambda がサービスユーザーの認証情報を参照できていません。環境変数が **Hosting → Environment variables**（Build settings ではなく）に設定されており、最新のビルドが取得していることを確認してください。

### `401 unauthorized`

- Bearer トークンが間違っているか、期限切れか、失効しています。
- `/admin/mcp-tokens` を開いてトークンがまだ一覧に表示されているか確認し、なければ新しいものを発行してください。

### `403 admin role required`

トークンのロールが `editor` ですが、呼び出したツールには `admin` が必要です。そのクライアント向けに `admin` ロールで新しいトークンを発行してください。

### `Cognito returned NEW_PASSWORD_REQUIRED`

サービスユーザーがサインアップ後の「パスワード強制リセット」状態にあります。サービスユーザーの認証情報で `/admin/login` から一度サインインし、恒久パスワードの設定画面に進んで恒久パスワードを設定してから、環境変数に新しいパスワードを設定してください。

## stdio CLI（サンドボックス / ローカル開発用）

HTTP ルートは本番環境向けの stdio CLI の代替です。stdio CLI（`npx -y @ampless/mcp-server@alpha`）は引き続き以下のケースで有用です：

- 開発中に AI クライアントからローカルの `npx ampx sandbox` を操作する。
- ディスク上に `amplify_outputs.json` がある CI / スクリプト環境。

stdio CLI はユーザー自身の Cognito 認証情報で認証し、サービスユーザーの設定を省略できます — ただし、ローカルに `amplify_outputs.json` がある環境へのデプロイメントにのみ対応しています。
