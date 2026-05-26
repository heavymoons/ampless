---
"@ampless/admin": minor
---

MCP token management UI (Phase 2 — client-side only)

Add `createMcpTokensPage` page factory and `McpTokensView` component for
issuing and revoking MCP API tokens directly from the admin UI.

The view is fully client-side: it calls `listTokens`, `createToken`,
and `revokeToken` storage functions via `installAdminKvProvider`
(user-pool-auth AppSync path). No server routes, no new env vars required.

The create modal lets the admin choose an optional expiration
(never / 30 days / 90 days / custom date). On success a one-time token
reveal modal is shown; the plain token is never persisted.

Changes:
- `packages/admin/src/components/mcp-tokens-view.tsx` — UI component
- `packages/admin/src/pages/mcp-tokens.tsx` — page factory
- `packages/admin/src/pages/index.ts` — export `createMcpTokensPage`
- `packages/admin/src/components/sidebar.tsx` — add MCP tokens nav item
- `packages/admin/src/locales/{en,ja}.json` — i18n strings
- `templates/_shared/app/(admin)/admin/mcp-tokens/page.tsx` — scaffold shell
