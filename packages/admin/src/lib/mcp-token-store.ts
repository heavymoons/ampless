/**
 * Module-local registry for the admin UI's MCP token store. Mirrors
 * the `setKvStore` / `getKvStore` pattern in `ampless` but stays
 * admin-internal because no other package needs to plug into it:
 * the AppSync `McpToken` model is admin-only and the MCP Lambda
 * reads DynamoDB directly without going through this abstraction.
 *
 * Tests inject an in-memory implementation via `setMcpTokenStore`;
 * the production wiring uses `installAdminMcpTokenProvider`
 * (`./mcp-token-provider.ts`), which talks to AppSync through the
 * generated Amplify client.
 */

export interface McpTokenRow {
  /** SHA-256 hex of the plaintext token (= storage identifier). */
  hash: string
  /** Plaintext prefix for UI display, e.g. "amk_AbCd". */
  prefix: string
  /** Cognito `sub` of the admin who issued the token. */
  createdBy: string
  createdByEmail: string
  /** ISO 8601. */
  issuedAt: string
  /** ISO 8601 or null. Updated by the validator on each successful auth. */
  lastUsedAt: string | null
  /** ISO 8601 or null. Token rejected after this point. */
  expiresAt: string | null
  /** ISO 8601 or null. Token rejected once set. */
  revokedAt: string | null
}

export interface McpTokenStore {
  list(): Promise<McpTokenRow[]>
  get(hash: string): Promise<McpTokenRow | null>
  put(row: McpTokenRow): Promise<void>
  remove(hash: string): Promise<void>
}

let store: McpTokenStore | null = null

export function setMcpTokenStore(s: McpTokenStore): void {
  store = s
}

export function getMcpTokenStore(): McpTokenStore {
  if (!store) {
    throw new Error(
      'No McpTokenStore configured. Call installAdminMcpTokenProvider() ' +
        'from the admin app entry point, or setMcpTokenStore() in tests.'
    )
  }
  return store
}

export function hasMcpTokenStore(): boolean {
  return store !== null
}
