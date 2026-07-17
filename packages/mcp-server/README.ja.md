> English: [README.md](./README.md)
> 

# @ampless/mcp-server

[ampless](https://github.com/heavymoons/ampless) 向け MCP ツールレジストリ。

**直接インストールする必要はありません。** `@ampless/backend` の `mcp-handler` Lambda が `./tools` サブパスエクスポート経由で使い、`@ampless/admin` / `@ampless/backend` を入れると推移的に付いてきます。

## 全体の構成

```
Admin MCP:  クライアント (.mcp.json) ── Bearer amk_… ──▶ mcp-handler Lambda (@ampless/backend)
                                                          ├── @ampless/mcp-server/tools    (admin ツールレジストリ)
                                                          └── @ampless/mcp-server/jsonrpc  (共有 JSON-RPC dispatch)

Public MCP: 匿名クライアント ────────────────────────▶ /api/mcp ルート (@ampless/runtime)
                                                          ├── @ampless/mcp-server/public   (読み取り専用ツール)
                                                          └── @ampless/mcp-server/jsonrpc  (共有 JSON-RPC dispatch)
```

admin の `mcp-handler` Lambda は Bearer トークンを `McpToken` AppSync モデル（admin 専用）に照合し、`ToolContext`（GraphQL クライアント + S3 クライアント + サイトコンテキスト）を構築して、各リクエストを共有 `dispatchJsonRpc` で admin の `tools` レジストリに対して実行します。公開 runtime ルートは読み取り専用の `PublicToolContext` を注入し、同じ `dispatchJsonRpc` を `publicTools` に対して実行します — トークン不要・公開投稿のみ。

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

3 つのサブパスエントリ：

| サブパス | 用途 |
|---|---|
| `@ampless/mcp-server/tools` | admin ツールレジストリ（トークン認証、フル read/write） |
| `@ampless/mcp-server/jsonrpc` | 両エンドポイントで共有するトランスポート非依存の JSON-RPC 2.0 dispatch |
| `@ampless/mcp-server/public` | 読み取り専用の公開ツール（匿名、公開投稿のみ） |

### `./tools`

```typescript
import { getTools, dispatchToolCall } from '@ampless/mcp-server/tools'
import type { ToolDefinition, ToolContext, ResolvedSite } from '@ampless/mcp-server/tools'
```

| エクスポート | 説明 |
|---|---|
| `tools` / `getTools()` | admin の `ToolDefinition[]` レジストリ |
| `dispatchToolCall(name, args, ctx)` | 名前でツールを引いて handler を呼ぶ（不明なら `null`） |
| `ToolDefinition<TCtx>` | 単一ツール（name、description、inputSchema、handler、`readOnly?`、`destructive?`） |
| `ToolContext` | admin ランタイムコンテキスト（graphql、storage、site） |
| `ResolvedSite` | 解決済みサイトコンテキスト（name、url、environment、siteId） |

### `./jsonrpc`

```typescript
import {
  dispatchJsonRpcMessage,
  dispatchJsonRpc,
  ToolUserError,
  MAX_BATCH,
} from '@ampless/mcp-server/jsonrpc'
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcMessageResult,
} from '@ampless/mcp-server/jsonrpc'
```

| エクスポート | 説明 |
|---|---|
| `dispatchJsonRpcMessage(input, opts)` | **推奨エントリポイント。** 未検証のデコード済みメッセージ（`unknown` — 単一オブジェクト **または** batch 配列）を受け取り、タグ付き `JsonRpcMessageResult` を返す：`{ status: 'invalid', body }`（HTTP 400 — 非オブジェクト / 空 / 過大 batch）、`{ status: 'ok', body }`（HTTP 200 — 単一レスポンス、または batch のレスポンス配列）、`{ status: 'no-content' }`（HTTP 202 — notification のみ）。エンベロープ検証と batch 処理（逐次・順序維持・batch 内 `initialize` 禁止）をここに集約したので、トランスポートは `JSON.parse` の生の結果をそのまま渡せる。`opts.maxBatch` の既定は `MAX_BATCH` |
| `dispatchJsonRpc(req, opts)` | **検証済みの** JSON-RPC リクエストを 1 件ツールレジストリに対して実行（`initialize` のバージョンネゴシエーション、annotations 付き `tools/list`、`tools/call`、notification 処理）。notification（`id` 無し）は method を実行しつつレスポンスの代わりに `null` を返す。`id: null` / 小数 id は `INVALID_REQUEST` で拒否。ワイヤから来たものはエンベロープ検証と batch 対応を集約した `dispatchJsonRpcMessage` を使うこと |
| `ToolUserError` / `isToolUserError` | client に返して安全な message を持つ想定内の tool failure を示す。独立 bundle の package entry 間でも認識でき、dispatcher はこの class に対して `formatToolError` と logging を迂回する。message に secret、内部詳細、未処理のユーザ入力を絶対に入れないこと |
| `MAX_BATCH` | batch 要素数の既定上限（`50`） |
| `jsonRpcResult` / `jsonRpcError` / `JSON_RPC_*` | エンベロープヘルパ + 標準エラーコード |
| `SUPPORTED_PROTOCOL_VERSIONS` | `['2025-03-26', '2024-11-05']` |

### `./public`

```typescript
import { publicTools } from '@ampless/mcp-server/public'
import type { PublicToolContext } from '@ampless/mcp-server/public'
```

| エクスポート | 説明 |
|---|---|
| `publicTools` | 読み取り専用の 4 ツール（`ToolDefinition<PublicToolContext>`） |
| `PublicToolContext` | runtime が注入する最小の読み取り面（`listPublishedPosts` / `getPublishedPost` / `postToMarkdown`） |
| `toPublicSummary` | `Post` のフィールド allowlist 射影 |

## ツール一覧

### Admin（`./tools`、トークン認証）

| ツール | role | 説明 |
|---|---|---|
| `list_posts` | reader | 投稿の軽量サマリー（body なし — 本文は `get_post`）。検索/ソート/フィルター対応。`{ posts, total, offset, limit }` を返す |
| `get_post` | reader | slug または postId で単一の投稿を取得 |
| `create_post` | editor | 新しい投稿を作成（下書きまたは公開済み） |
| `update_post` | editor | 既存の投稿のフィールドをパッチ更新 |
| `delete_post` | editor | 投稿を削除しタグインデックスをクリーンアップ |
| `upload_media` | editor | Base64 バイト列を S3 にアップロードし Media レコードを作成 |
| `list_media` | reader | メディア一覧。`mimeType`（前方一致）/ `prefix` / `createdAfter` / `createdBefore` フィルターとページネーション対応 |
| `search_media` | reader | ファイル名 / `src` / `mimeType` への部分一致でメディアを検索 |
| `delete_media` | editor | メディアファイルを削除（S3 オブジェクト + Media 行）。`mediaId` または `src` で指定。`dryRun: true` でプレビュー |
| `get_schema` | reader | CMS コンテンツスキーマを返す |
| `upload_static_bundle` | editor | ビルド済み静的バンドル（zip）を S3 に 1 発でアップロード |
| `upload_static_file` | editor | 静的バンドルの S3 プレフィックスに 1 ファイルずつ差分アップロード |
| `delete_static_file` | editor | 静的バンドルの S3 プレフィックスからファイルを差分削除 |
| `commit_static_post` | editor | S3 プレフィックスから Post manifest を再構築（"save" ステップ） |

### Public（`./public`、匿名、公開投稿のみ）

| ツール | 説明 |
|---|---|
| `list_posts` | 新しい順の公開投稿サマリー 1 ページ + 不透明な `nextCursor` |
| `get_post` | slug で公開投稿 1 件、本文を `markdown` にレンダリング（10 万字超は切り詰め） |
| `search_posts` | 有界走査に対する title / slug / tags / excerpt への大小無視部分一致 |
| `list_tags` | 同じ有界走査でのタグ出現数（降順） |
