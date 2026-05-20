/**
 * Abstract contracts each tool handler depends on. Concrete
 * implementations live elsewhere:
 *
 *   - Stdio CLI: `src/appsync.ts` (Cognito-id-token bearer) and
 *     `src/s3.ts` (default-credential-chain S3 client).
 *   - HTTP transport: `@ampless/admin/api/mcp` wraps the consumer's
 *     existing `generateClient<Schema>()` + S3 client.
 *
 * Both routes satisfy these interfaces structurally (no `implements`
 * needed) — TypeScript's structural typing checks the shape on the
 * call site. Tools never instantiate these themselves; the caller
 * passes a ready `ToolContext` into `dispatchToolCall`.
 */
export interface GraphqlClient {
  query<T>(operation: string, variables?: Record<string, unknown>): Promise<T>
}

export interface StorageClient {
  /**
   * Upload `body` to the bucket at `key` with `contentType`. Returns
   * the public URL of the stored object (same format both routes use:
   * https://{bucket}.s3.{region}.amazonaws.com/{key}).
   */
  putObject(key: string, body: Uint8Array, contentType: string): Promise<string>
}

export interface ToolContext {
  graphql: GraphqlClient
  storage: () => StorageClient
  defaultSiteId: string
}
