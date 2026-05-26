/**
 * Site context passed from the HTTP transport into each tool call.
 * The mcp-handler Lambda resolves this from the MCP access token.
 */
export interface ResolvedSite {
  name: string
  url?: string
  environment: 'prod' | 'stg' | 'dev'
  siteId: string
}

/**
 * Abstract contracts each tool handler depends on. Concrete
 * implementations live in `@ampless/backend`'s mcp-handler Lambda:
 *
 *   - `mcp-graphql-client.ts` — AppSync GraphQL client (Bearer token)
 *   - `mcp-storage-client.ts` — S3 client for media operations
 *
 * Both satisfy these interfaces structurally (no `implements` needed)
 * — TypeScript's structural typing checks the shape on the call site.
 * Tools never instantiate these themselves; the caller passes a ready
 * `ToolContext` into `dispatchToolCall`.
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

export interface PutObjectResult {
  /**
   * Public URL of the stored object (same format both routes use:
   * https://{bucket}.s3.{region}.amazonaws.com/{key}).
   */
  url: string
  /**
   * S3 ETag of the stored bytes when the underlying client surfaces
   * it. Captured at upload time so the Media DynamoDB row can record
   * it and the media-proxy route can later passthrough it as a
   * response header (enabling conditional GETs from CDN clients).
   * Optional because not all `StorageClient` impls have access to
   * the raw S3 response.
   */
  etag?: string
}

export interface StorageClient {
  /**
   * Upload `body` to the bucket at `key` with `contentType`. Returns
   * the public URL and (when available) the S3 ETag of the stored
   * object.
   */
  putObject(
    key: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<PutObjectResult>

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
