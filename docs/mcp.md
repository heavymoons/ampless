> 日本語版: [mcp.ja.md](./mcp.ja.md)
>

# Public MCP endpoint & discovery

ampless can expose an **anonymous, read-only MCP endpoint** so AI clients (Claude, Cursor, VS Code, agents) can read your published content over the [Model Context Protocol](https://modelcontextprotocol.io). This guide covers enabling it, connecting from common clients, and the experimental discovery metadata that lets clients find the endpoint on their own.

## What it is

- **Read-only.** Four tools — `list_posts`, `get_post`, `search_posts`, `list_tags` — all annotated `readOnlyHint: true`. There is no write path.
- **Published only.** Every tool reads through the published-index resolvers; drafts are never reachable, and internal fields (`postId`, `status`, raw `body`, `metadata`) are never emitted.
- **Anonymous.** No token. Because it is unauthenticated, it is **off by default** and opt-in.
- **JSON-RPC 2.0 over HTTP POST** at `/api/mcp`.

This is separate from the token-authenticated **admin** MCP (Lambda Function URL + Bearer `amk_…`), which is read/write and admin-issued. See [architecture/04-access-layer-mcp.md](./architecture/04-access-layer-mcp.md) for the full access-layer picture.

## Enabling it

In `cms.config.ts`:

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

- `publicMcp: true` is all you need for the endpoint itself.
- `mcpDiscovery: true` is **experimental** and additionally publishes the well-known catalog and Server Card. It requires `publicMcp: true` and an `http(s)` `site.url` (discovery advertises absolute URLs). If either is missing, the discovery routes 404.

### URLs

| Purpose | URL |
|---|---|
| MCP endpoint (JSON-RPC POST) | `https://<site>/api/mcp` |
| Discovery catalog (`mcpDiscovery` on) | `https://<site>/.well-known/mcp/catalog.json` |
| Server Card (`mcpDiscovery` on) | `https://<site>/api/mcp/server-card` |

## Connecting from a client

The three clients below use **different config shapes** — don't mix them up.

### Claude Code (CLI)

```bash
claude mcp add --transport http my-site https://example.com/api/mcp
```

### Cursor

`~/.cursor/mcp.json` (or the project's `.cursor/mcp.json`) uses a top-level `mcpServers` map:

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

`.vscode/mcp.json` uses a top-level `servers` map and an explicit `"type": "http"`:

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

## Rate limiting & abuse protection

The route ships a **coarse warm-instance circuit breaker** (a single fixed-window counter, ~600 req/min per warm Lambda; a batch charges one unit per element), **not** a per-IP rate limiter — CloudFront preserves a client-supplied `x-forwarded-for` and only appends the real edge IP, so a trustworthy client IP can't be derived at this layer. It also caps request bodies at 64 KB.

For real per-IP throttling and DoS protection, **pair `publicMcp: true` with CloudFront / AWS WAF** in front of the site. The data-exposure surface is already bounded structurally (published-only, read-only, per-request page/item caps).

## Discovery (experimental)

When `mcpDiscovery: true`, ampless publishes two documents following the prototype [`modelcontextprotocol/experimental-ext-server-card`](https://github.com/modelcontextprotocol/experimental-ext-server-card) spec (SEP-2127, still **open / unmerged**), so an AI client can discover the endpoint without being handed its URL:

1. **Catalog** at `/.well-known/mcp/catalog.json` — a site-level list with one entry pointing at the Server Card:

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

2. **Server Card** at `/api/mcp/server-card` — the server's identity, website, and transport (but not its tool list, which stays a runtime `tools/list` call):

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

The Server Card `name`/`version` deliberately match the live endpoint's `initialize` `serverInfo` (a reverse-DNS name derived from `site.url` + the same version) so the advertised identity never disagrees with the running server. Enabling `mcpDiscovery` is the only thing that changes the `/api/mcp` `initialize` `serverInfo` wire shape — default-off sites keep the static `ampless-mcp / 0.2`.

> **Experimental.** The catalog / Server Card schema and paths track an unmerged upstream prototype and may change. No published AI client is known to consume well-known MCP discovery yet; enabling it is low-cost forward-compatibility, not an immediate auto-connect.

## Publishing to the MCP Registry

The [MCP Registry](https://github.com/modelcontextprotocol/registry) (currently **preview** — expect breaking changes and possible data resets) lists servers via a `server.json` that is a near-superset of the Server Card. ampless does **not** generate `server.json` for you: registry publishing requires proving ownership of the namespace you register under, which only you (the operator) can do. Install the official `mcp-publisher` CLI first:

```bash
# Homebrew
brew install mcp-publisher

# …or a release binary (macOS/Linux)
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" \
  | tar xz mcp-publisher && sudo mv mcp-publisher /usr/local/bin/
```

The namespace you're allowed to publish under **depends on which authentication method you choose** — pick one before scaffolding `server.json`:

| Authentication | `name` format                                     | Example                          |
| -------------- | -------------------------------------------------- | --------------------------------- |
| GitHub OAuth   | `io.github.<username-or-org>/*`                    | `io.github.alice/ampless-mcp`     |
| DNS TXT        | `<reverse-dns-of-your-domain>/*`                   | `com.example/ampless-mcp`         |
| HTTP file      | `<reverse-dns-of-your-domain>/*`                   | `com.example/ampless-mcp`         |

All three start the same way — scaffold, then fill in the remote endpoint:

```bash
mcp-publisher init
```

```json
{
  "name": "<namespace from the table above>/ampless-mcp",
  "description": "Read-only MCP endpoint for published posts.",
  "version": "0.2.0",
  "remotes": [
    { "type": "streamable-http", "url": "https://example.com/api/mcp" }
  ]
}
```

Then prove ownership with **one** of the following, matching the `name` you chose above. `mcp-publisher publish` comes **after** a successful login — running it unauthenticated fails.

### (a) GitHub OAuth → `io.github.<user>/*`

No keys to manage — the CLI drives a device-code OAuth flow and grants your personal `io.github.<username>/*` namespace (an **org**-owned namespace additionally requires you to be an **Owner** of that org). Set `server.json`'s `name` to `io.github.<your-username>/ampless-mcp` and run:

```bash
mcp-publisher login github
```

Follow the printed `https://github.com/login/device` link and enter the code; the CLI confirms `✓ Successfully logged in`.

### (b) DNS TXT → `com.example/*` (reverse-DNS of your own domain)

Set `server.json`'s `name` to the reverse-DNS form of a domain you control, e.g. `com.example/ampless-mcp` for `example.com`. Generate a keypair, publish the public half as a DNS TXT record **at the domain apex** (not a subdomain/selector), then log in with the private half:

```bash
MY_DOMAIN="example.com"

# 1. Generate an Ed25519 keypair (requires OpenSSL >= 3.0 — macOS's
#    system `openssl` is LibreSSL and doesn't support Ed25519 in
#    `genpkey`; on macOS install `brew install openssl@3` and invoke it
#    explicitly, e.g. /opt/homebrew/opt/openssl@3/bin/openssl).
openssl genpkey -algorithm Ed25519 -out key.pem

# 2. Derive the TXT record value and add it at the domain apex via your
#    DNS provider (e.g. example.com. IN TXT "v=MCPv1; k=ed25519; p=...").
PUBLIC_KEY="$(openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)"
echo "${MY_DOMAIN}. IN TXT \"v=MCPv1; k=ed25519; p=${PUBLIC_KEY}\""

# 3. Once the TXT record has propagated, log in with the private key.
PRIVATE_KEY="$(openssl pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"
mcp-publisher login dns --domain "${MY_DOMAIN}" --private-key "${PRIVATE_KEY}"
```

### (c) HTTP file → `com.example/*` (reverse-DNS of your own domain)

Same namespace and keypair as DNS, but ownership is proven by hosting a file instead of a DNS record — useful when you can deploy to the domain but don't control its DNS. ampless passes any `/.well-known/*` path other than the MCP catalog straight through to Next, so serving this file is up to you and won't collide:

```bash
MY_DOMAIN="example.com"

# 1. Generate an Ed25519 keypair (same OpenSSL >= 3.0 caveat as DNS auth).
openssl genpkey -algorithm Ed25519 -out key.pem

# 2. Write the proof file and host it at
#    https://example.com/.well-known/mcp-registry-auth
PUBLIC_KEY="$(openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)"
echo "v=MCPv1; k=ed25519; p=${PUBLIC_KEY}" > mcp-registry-auth

# 3. Once the file is live, log in with the private key.
PRIVATE_KEY="$(openssl pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"
mcp-publisher login http --domain "${MY_DOMAIN}" --private-key "${PRIVATE_KEY}"
```

### Publish

Once logged in with any of the three methods above, publish from the directory containing your `server.json`:

```bash
mcp-publisher publish
```

## See also

- [AI_FRIENDLY.md](./AI_FRIENDLY.md) — the broader AI-readable publishing design.
- [architecture/04-access-layer-mcp.md](./architecture/04-access-layer-mcp.md) — access layer, admin vs. public MCP, tool registry.
