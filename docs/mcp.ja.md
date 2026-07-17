> English: [mcp.md](./mcp.md)
>

# 公開 MCP endpoint と discovery

ampless は **匿名・読み取り専用の MCP endpoint** を公開できるため、AI クライアント（Claude、Cursor、VS Code、エージェント）が [Model Context Protocol](https://modelcontextprotocol.io) 経由で公開済みコンテンツを読み取れる。このガイドでは、有効化の方法、主要クライアントからの接続方法、そしてクライアントが自力で endpoint を見つけられるようにする experimental な discovery metadata について説明する。

## これは何か

- **読み取り専用。** `list_posts`、`get_post`、`search_posts`、`list_tags` の 4 tool はすべて `readOnlyHint: true` として annotate されている。write path は存在しない。
- **公開済みのみ。** すべての tool は published-index resolver を通して読み取り、draft には決して到達できず、内部フィールド（`postId`、`status`、生の `body`、`metadata`）は決して出力されない。
- **匿名。** トークン不要。無認証であるため、**デフォルトで無効**の opt-in。
- **JSON-RPC 2.0 over HTTP POST**、`/api/mcp` で提供。

これはトークン認証される **admin** MCP（Lambda Function URL + Bearer `amk_…`）とは別物で、そちらは admin が発行する読み書き可能な endpoint。アクセスレイヤ全体の設計は [architecture/04-access-layer-mcp.ja.md](./architecture/04-access-layer-mcp.ja.md) を参照。

## 有効化

`cms.config.ts` で:

```ts
export default defineConfig({
  site: { name: 'My Site', url: 'https://example.com' },
  // ...
  ai: {
    publicMcp: true,      // exposes /api/mcp (read-only, published-only)
    mcpDiscovery: true,   // experimental — publishes discovery metadata (see below)
  },
})
```

- endpoint 自体を使うだけなら `publicMcp: true` だけで足りる。
- `mcpDiscovery: true` は **experimental** で、これを追加すると well-known catalog と Server Card も公開される。`publicMcp: true` と `http(s)` の `site.url`（discovery は絶対 URL を広告するため）が必須。どちらかが欠けている場合、discovery routes は 404 を返す。

### URL

| Purpose | URL |
|---|---|
| MCP endpoint (JSON-RPC POST) | `https://<site>/api/mcp` |
| Discovery catalog (`mcpDiscovery` on) | `https://<site>/.well-known/mcp/catalog.json` |
| Server Card (`mcpDiscovery` on) | `https://<site>/api/mcp/server-card` |

## クライアントからの接続

以下の 3 クライアントは**それぞれ異なる設定形式**を使う — 混同しないこと。

### Claude Code (CLI)

```bash
claude mcp add --transport http my-site https://example.com/api/mcp
```

### Cursor

`~/.cursor/mcp.json`（またはプロジェクトの `.cursor/mcp.json`）はトップレベルの `mcpServers` マップを使う:

```json
{
  "mcpServers": {
    "my-site": {
      "url": "https://example.com/api/mcp"
    }
  }
}
```

### VS Code

`.vscode/mcp.json` はトップレベルの `servers` マップと明示的な `"type": "http"` を使う:

```json
{
  "servers": {
    "my-site": {
      "type": "http",
      "url": "https://example.com/api/mcp"
    }
  }
}
```

## Tools

| Tool | Description |
|---|---|
| `list_posts` | One page of newest-first published-post summaries + an opaque `nextCursor` |
| `get_post` | A single published post by slug, body rendered to Markdown (truncated past 100k chars) |
| `search_posts` | Case-insensitive substring over title / slug / tags / excerpt across a bounded recent-post scan |
| `list_tags` | Tag occurrence counts (descending) over the same bounded scan |

## レート制限と乱用対策

このルートは **粗い warm-instance circuit breaker**（1 個の固定ウィンドウカウンタ、warm な Lambda 1 個あたり約 600 req/min、batch は要素ごとに 1 単位を消費）を実装しているが、per-IP rate limiter では**ない** — CloudFront はクライアントが送った `x-forwarded-for` をそのまま保持し実 edge IP を追記するだけなので、このレイヤでは信頼できる client IP を導出できない。また、request body は 64 KB を上限とする。

実際の per-IP throttling と DoS 対策が必要な場合は、**`publicMcp: true` と CloudFront / AWS WAF をサイトの手前に組み合わせて**使うこと。データ露出面はすでに構造的に有界化されている（公開済みのみ、読み取り専用、リクエストごとのページ/件数上限あり）。

## Discovery (experimental)

`mcpDiscovery: true` のとき、ampless はプロトタイプ [`modelcontextprotocol/experimental-ext-server-card`](https://github.com/modelcontextprotocol/experimental-ext-server-card) 仕様（SEP-2127、まだ **open / unmerged**）に準拠した 2 つのドキュメントを公開し、AI クライアントが URL を渡されなくても endpoint を発見できるようにする:

1. **Catalog** — `/.well-known/mcp/catalog.json` — Server Card を指す 1 エントリを持つサイト単位のリスト:

   ```json
   {
     "specVersion": "draft",
     "entries": [
       {
         "identifier": "urn:air:example.com:ampless-mcp",
         "type": "application/mcp-server-card+json",
         "url": "https://example.com/api/mcp/server-card"
       }
     ]
   }
   ```

2. **Server Card** — `/api/mcp/server-card` — server の identity、website、transport を示す（tool 一覧は含まない。tool 一覧は引き続き runtime の `tools/list` 呼び出しで取得する）:

   ```json
   {
     "$schema": "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
     "name": "com.example/ampless-mcp",
     "version": "0.2.0",
     "description": "My Site — read-only MCP endpoint for published posts (list, get, search, tags).",
     "title": "My Site",
     "websiteUrl": "https://example.com",
     "remotes": [
       {
         "type": "streamable-http",
         "url": "https://example.com/api/mcp",
         "supportedProtocolVersions": ["2025-03-26", "2024-11-05"]
       }
     ]
   }
   ```

Server Card の `name` / `version` は、稼働中 endpoint の `initialize` の `serverInfo`（`site.url` から導出した reverse-DNS 名 + 同じ version）と意図的に一致させてあるため、広告される identity が稼働中の server と食い違うことはない。`mcpDiscovery` を有効化することだけが、`/api/mcp` の `initialize` `serverInfo` の wire 形式を変える唯一の要因であり、デフォルトで無効なサイトは静的な `ampless-mcp / 0.2` のままとなる。

> **Experimental。** catalog / Server Card の schema とパスは unmerged な upstream プロトタイプに追随しているため変わり得る。well-known MCP discovery を消費することが確認されている公開 AI クライアントは現時点で存在しない。有効化することは低コストな forward-compatibility であり、即座の auto-connect を意味するものではない。

## MCP Registry への公開

[MCP Registry](https://github.com/modelcontextprotocol/registry)（現在 **preview** — 破壊的変更やデータリセットの可能性あり）は、Server Card のほぼ superset である `server.json` を通じて server を掲載する。ampless は `server.json` を自動生成**しない** — registry への公開には、登録する namespace の所有権を証明する必要があり、それができるのは operator（あなた）だけだから。公式の `mcp-publisher` フローを使うこと:

1. `server.json` を **scaffold** する:

   ```bash
   mcp-publisher init
   ```

2. remote endpoint と identity を**記入**する。自分の ampless endpoint を `remotes` エントリにマップし、`name` は自分が証明できる namespace に設定する:

   ```json
   {
     "name": "com.example/ampless-mcp",
     "description": "Read-only MCP endpoint for published posts.",
     "version": "0.2.0",
     "remotes": [
       { "type": "streamable-http", "url": "https://example.com/api/mcp" }
     ]
   }
   ```

3. namespace の**所有権を証明**する（DNS TXT、HTTP `/.well-known/mcp-registry-auth`、または GitHub OAuth）:

   ```bash
   mcp-publisher login dns    # or: http | github
   ```

   HTTP による所有権証明を使う場合は、認証ドキュメントをサイトの `/.well-known/mcp-registry-auth` に置くこと — ampless は MCP catalog 以外の `/.well-known/*` パスをすべてそのまま Next に通すので、このファイルを配信するかどうかはあなた次第であり、衝突は起きない。

4. **公開**する:

   ```bash
   mcp-publisher publish
   ```

## 参照

- [AI_FRIENDLY.ja.md](./AI_FRIENDLY.ja.md) — より広い AI-readable publishing の設計。
- [architecture/04-access-layer-mcp.ja.md](./architecture/04-access-layer-mcp.ja.md) — アクセスレイヤ、admin と公開 MCP の違い、tool レジストリ。
