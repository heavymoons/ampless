import type { ResolvedSite } from '../site.js'
export type { ResolvedSite }

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

export interface StorageObject {
  /** Full S3 key including any prefix. */
  key: string
  /** Object size in bytes (0 when the backend can't supply it). */
  size: number
  /** ISO 8601 timestamp of the last write, when the backend supplies it. */
  lastModified?: string
}

export interface StorageClient {
  /**
   * Upload `body` to the bucket at `key` with `contentType`. Returns
   * the public URL of the stored object (same format both routes use:
   * https://{bucket}.s3.{region}.amazonaws.com/{key}).
   */
  putObject(key: string, body: Uint8Array, contentType: string): Promise<string>

  /**
   * Remove the object at `key`. Implementations should treat a missing
   * key as success (S3 DeleteObject is idempotent by default).
   */
  deleteObject(key: string): Promise<void>

  /**
   * List every object under `prefix`. Implementations are expected to
   * paginate internally so the caller gets the full set in a single
   * resolved promise — the static-bundle tools never expect more than
   * a few hundred entries per bundle in practice.
   */
  listObjects(prefix: string): Promise<StorageObject[]>
}

export interface ToolContext {
  graphql: GraphqlClient
  storage: () => StorageClient
  site?: ResolvedSite
}
