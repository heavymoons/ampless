> English: [README.md](./README.md)
> 

# @ampless/mcp-server

[ampless](https://github.com/heavymoons/ampless) 向け MCP（Model Context Protocol）サーバー。Claude Desktop、Cursor、Claude Code、その他 MCP 対応ツールから AI エージェントが CMS インスタンスの投稿を読み書きしたり、メディアをアップロードしたりできます。

> **プレリリース / アルファ版。** v1.0 まではマイナーバージョンでも破壊的変更が入る可能性があります。

## ツール一覧

| ツール | 機能 |
|---|---|
| `list_posts` | オプションの `status` フィルターとページネーション付きで投稿一覧を取得 |
| `get_post` | `slug` または `postId` で単一の投稿を取得 |
| `create_post` | 新しい投稿を作成（下書きまたは公開済み） |
| `update_post` | 既存の投稿のフィールドをパッチ更新 |
| `delete_post` | 投稿を削除しタグインデックスをクリーンアップ |
| `upload_media` | Base64 エンコードされたバイト列を S3 にアップロードし `Media` レコードを作成 |
| `get_schema` | CMS コンテンツスキーマ（Post / Page / Media のフィールド形状）を返す |

サーバーは指定した認証情報（環境変数）で Cognito ユーザープールにサインインするため、各ツールはそのユーザーのロール（`ampless-admin` または `ampless-editor`）で動作します。下書きや編集内容は認証済みユーザーにのみ表示されます。リゾルバー側の `status === 'published'` フィルターにより、未公開コンテンツはパブリック読み取りからは見えません。

## インストール

サーバーは Node CLI として公開されています。グローバルインストールは通常不要です — MCP クライアントから `npx -y @ampless/mcp-server@alpha` を指定してください。

## 設定

以下が必要です：

1. **`amplify_outputs.json`** — `npx ampx sandbox` または `npx ampx pipeline-deploy` で生成されます。パスは `--outputs` で渡します。
2. **Cognito ユーザーアカウント** — ユーザープールのメールアドレスとパスワード。管理 UI から最初に作成したユーザーは自動的に `ampless-admin` に登録されます。
3. **AWS 認証情報** — `upload_media` を使用する場合にのみ必要です。デフォルトの認証情報チェーン（`AWS_PROFILE`、環境変数、インスタンスロール）が使用されます。読み取り専用ツールは AWS 認証情報なしで動作します。

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）またはプラットフォームに応じた同等のパスを編集します：

```json
{
  "mcpServers": {
    "ampless": {
      "command": "npx",
      "args": [
        "-y",
        "@ampless/mcp-server",
        "--outputs",
        "/absolute/path/to/your-site/amplify_outputs.json"
      ],
      "env": {
        "AMPLESS_MCP_EMAIL": "you@example.com",
        "AMPLESS_MCP_PASSWORD": "your-password"
      }
    }
  }
}
```

Claude Desktop を再起動すると、7 つのツールが `/mcp` の下に表示されます。

### Cursor

`~/.cursor/mcp.json` を編集するか、**Cursor Settings → MCP** を使用します。設定の形式は Claude Desktop と同じです：

```json
{
  "mcpServers": {
    "ampless": {
      "command": "npx",
      "args": ["-y", "@ampless/mcp-server", "--outputs", "/path/to/amplify_outputs.json"],
      "env": {
        "AMPLESS_MCP_EMAIL": "you@example.com",
        "AMPLESS_MCP_PASSWORD": "your-password"
      }
    }
  }
}
```

### Claude Code

プロジェクトレベルの MCP サーバーを追加します：

```bash
claude mcp add ampless \
  --env AMPLESS_MCP_EMAIL=you@example.com \
  --env AMPLESS_MCP_PASSWORD=your-password \
  -- npx -y @ampless/mcp-server --outputs /path/to/amplify_outputs.json
```

## 使用例

登録後、AI エージェントに次のように指示できます：

- 「最新の投稿を 5 件表示して。」
- 「スラッグ `welcome` の投稿を見せて。」
- 「タイトル '2 記事目' の下書きを markdown 形式で、本文 'Hello world.' で作成して。」
- 「投稿 `post-1234` を公開して。」
- 「スラッグ `bad-draft` の投稿を削除して。」

エージェントが自動的に適切なツールを選択します。

### `format` ごとの `body` の形式

- `format: 'markdown'` → body は markdown ソース文字列
- `format: 'html'` → body は生の HTML 文字列（そのままレンダリングされます — 下記のエディタートラストモデルを参照）
- `format: 'tiptap'` → body は tiptap ドキュメント JSON、例：

  ```json
  {
    "type": "doc",
    "content": [
      { "type": "paragraph", "content": [{ "type": "text", "text": "Hello" }] }
    ]
  }
  ```

AI に投稿本文を生成させる場合は、markdown を指定するのが最も簡単です。

## セキュリティに関する注意

- **エディタートラストモデル。** ampless は `editor` と `admin` を同一のトラストクラスとして扱います — どちらも投稿本文に任意の HTML / JS を格納できます（`docs/architecture/04-access-layer-mcp.md` 参照）。MCP サーバーが書き込める内容は、そのユーザーアカウントが管理 UI から書き込める内容と同じです。
- **設定ファイル内の認証情報。** `AMPLESS_MCP_PASSWORD` は Claude Desktop / Cursor の設定ファイル内にプレーンテキストで保存されます。SSH 秘密鍵と同様に扱ってください。v0.2 で OS キーチェーン連携を追加予定です。
- **AWS 認証情報。** `upload_media` のみ必要です。サイトの S3 バケットへの書き込み権限のみを持つ専用の IAM ユーザー / ロールを使用してください。

## CLI フラグ

```
ampless-mcp [options]

  --outputs <path>        amplify_outputs.json へのパス（AMPLESS_MCP_OUTPUTS でも指定可）
  --site-id <id>          クエリのデフォルト siteId（AMPLESS_MCP_SITE_ID でも指定可、デフォルト "default"）
```

必須の環境変数：

```
AMPLESS_MCP_EMAIL          Cognito ユーザーのメールアドレス
AMPLESS_MCP_PASSWORD       Cognito ユーザーのパスワード
```

## トラブルシューティング

- **`NotAuthorizedException: Incorrect username or password.`** — 認証情報が誤っているか、メールアドレスが未確認です。まず Web の `/login` から一度サインインしてください。
- **`InvalidPasswordException`** — ユーザーが `FORCE_CHANGE_PASSWORD` 状態です。Web UI からサインインして永続パスワードを設定してください。
- **`AppSync 401`** — ID トークンが拒否された可能性があります。サーバーは次の呼び出し時に自動更新します。繰り返し 401 が発生する場合は、ユーザープールが再デプロイされている可能性があるため認証情報を更新してください。
- **`upload_media` が AWS 認証情報なしで失敗する** — MCP サーバーの環境に `AWS_PROFILE` または `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` を設定してください。
