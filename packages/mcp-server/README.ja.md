> English: [README.md](./README.md)
> 

# @ampless/mcp-server

[ampless](https://github.com/heavymoons/ampless) 向け MCP ツールレジストリ（内部パッケージ）。

**このパッケージは npm に公開されておらず、直接インストールして使うものではありません。** `@ampless/backend` の `mcp-handler` Lambda が `./tools` サブパスエクスポート経由でインポートする、ワークスペース内部専用のライブラリです。

## 全体の構成

```
MCP クライアント (.mcp.json)
  └── HTTP Bearer トークン (amk_...)
        └── mcp-handler Lambda (packages/backend/src/functions/mcp-handler.ts)
              └── @ampless/mcp-server/tools  ← このパッケージ
                    └── ToolDefinition[], dispatchToolCall
```

`mcp-handler` Lambda は Bearer トークンを `McpToken` AppSync モデル（admin 専用）に照合し、`ToolContext`（GraphQL クライアント + S3 クライアント + サイトコンテキスト）を構築して、各ツール呼び出しをこのパッケージの `dispatchToolCall` に委譲します。

エンドユーザーは管理画面経由で MCP を設定します：

1. `/admin/mcp-tokens` にアクセスし、Bearer トークン（`amk_...`）を発行する。
2. Amplify コンソールまたは `amplify_outputs.json` で `mcp-handler` Lambda の Function URL を確認する。
3. MCP クライアントの設定ファイル（`.mcp.json`、`claude_desktop_config.json` など）にエントリを追加する：

```json
{
  "mcpServers": {
    "ampless": {
      "url": "https://<function-url-id>.lambda-url.<region>.on.aws/",
      "transport": "http",
      "headers": {
        "Authorization": "Bearer amk_..."
      }
    }
  }
}
```

HTTP MCP のアーキテクチャ全体については `docs/architecture/04-access-layer-mcp.md` を参照してください。

## エクスポート

### `./tools`

```typescript
import { getTools, dispatchToolCall } from '@ampless/mcp-server/tools'
import type { ToolDefinition, ToolContext, ResolvedSite } from '@ampless/mcp-server/tools'
```

| エクスポート | 説明 |
|---|---|
| `getTools()` | `ToolDefinition` オブジェクトのリスト（name、description、inputSchema）を返す |
| `dispatchToolCall(name, args, ctx)` | 名前でツール呼び出しをディスパッチする。不明なツール名の場合は例外をスロー |
| `ToolDefinition` | 単一ツールのインターフェース（name、description、inputSchema、handler） |
| `ToolContext` | ランタイムコンテキストのインターフェース（graphql、storage、site） |
| `ResolvedSite` | 解決済みサイトコンテキストのインターフェース（name、url、environment、siteId） |

## ツール一覧

| ツール | role | 説明 |
|---|---|---|
| `list_posts` | reader | オプションの status フィルターとページネーション付きで投稿一覧を取得 |
| `get_post` | reader | slug または postId で単一の投稿を取得 |
| `create_post` | editor | 新しい投稿を作成（下書きまたは公開済み） |
| `update_post` | editor | 既存の投稿のフィールドをパッチ更新 |
| `delete_post` | editor | 投稿を削除しタグインデックスをクリーンアップ |
| `upload_media` | editor | Base64 エンコードされたバイト列を S3 にアップロードし Media レコードを作成 |
| `get_schema` | reader | CMS コンテンツスキーマを返す |
| `upload_static_bundle` | editor | ビルド済み静的バンドルを S3 にアップロード |
| `list_static_files` | reader | 静的バンドルファイルを一覧表示 |
| `delete_static_file` | editor | 静的ファイルを S3 から削除 |
| `get_site_context` | reader | 現在のサイトコンテキスト（name、url、environment）を返す |
