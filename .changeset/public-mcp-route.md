---
"ampless": minor
"@ampless/mcp-server": minor
"@ampless/backend": patch
"@ampless/runtime": minor
"create-ampless": patch
---

Add an anonymous, read-only public MCP endpoint at `/api/mcp`.

- **`@ampless/runtime`**: new `createPublicMcpRouteHandler(ampless)` route factory (returns `{ POST, OPTIONS }`) serving the four `@ampless/mcp-server/public` tools over published posts only — never writes, never sees drafts. Adds open CORS (anonymous, read-only, credential-free), a 64KB byte-capped body reader (oversize bodies 413 without full buffering), an outermost guard that always answers with a CORS'd JSON-RPC 500 instead of a bare Next.js error, and a coarse circuit breaker.
- **`ampless`**: `AiConfig.publicMcp?: boolean` (default **false** — the endpoint is unauthenticated, so it is opt-in). The route 404s unless it is explicitly `true`.
- **`@ampless/mcp-server`**: new `dispatchJsonRpcMessage(input, opts)` + `MAX_BATCH`. It takes an unvalidated decoded message (single object or batch array) and returns a tagged result (`invalid` → 400 / `ok` → 200 / `no-content` → 202), centralising envelope validation and JSON-RPC **batch** support (sequential, order-preserving, `initialize` forbidden inside a batch). Prefer it over `dispatchJsonRpc` for anything coming off the wire.
- **`@ampless/backend`**: the admin MCP Lambda now dispatches through `dispatchJsonRpcMessage`, so the admin transport gains the same batch support and its envelope checks match the public route (it advertises `2025-03-26`, which requires batch receipt).
- **`create-ampless`**: scaffolds `app/api/mcp/route.ts` (destructuring both `POST` and `OPTIONS`) and documents `ai.publicMcp` in the `cms.config.ts` example.

**Circuit breaker scope:** the built-in limiter is a coarse, per-warm-instance fixed-window counter (600 req/min; a batch charges one unit per element), **not** a per-IP rate limiter. It is intentionally not keyed on `x-forwarded-for` — CloudFront preserves a client-supplied XFF and only appends the real edge IP, so the leftmost value is spoofable and the hop count is unknown, meaning no trustworthy client IP is derivable at this layer. It only bites within one warm lambda; real per-IP throttling / DoS protection is CloudFront / WAF's responsibility (operational).
