import type { ToolContext } from './types.js'

import { listPosts, listPostsSchema } from './list-posts.js'
import { getPost, getPostSchema } from './get-post.js'
import { createPost, createPostSchema } from './create-post.js'
import { updatePost, updatePostSchema } from './update-post.js'
import { deletePost, deletePostSchema } from './delete-post.js'
import { uploadMedia, uploadMediaSchema } from './upload-media.js'
import { listMedia, listMediaSchema } from './list-media.js'
import { searchMedia, searchMediaSchema } from './search-media.js'
import { deleteMedia, deleteMediaSchema } from './delete-media.js'
import { getSchema, getSchemaSchema } from './get-schema.js'
import { uploadStaticBundle, uploadStaticBundleSchema } from './upload-static-bundle.js'
import { uploadStaticFile, uploadStaticFileSchema } from './upload-static-file.js'
import { deleteStaticFile, deleteStaticFileSchema } from './delete-static-file.js'
import { commitStaticPost, commitStaticPostSchema } from './commit-static-post.js'

export type {
  GraphqlClient,
  StorageClient,
  StorageObject,
  ToolContext,
} from './types.js'
export {
  extractZipFromBuffer,
  decodeUtf8,
  type ExtractZipOptions,
} from './static-bundle-extract.js'

export interface ToolDefinition<TCtx = ToolContext> {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>, ctx: TCtx) => Promise<unknown>
  /**
   * `true` when the tool can destroy or irreversibly overwrite existing
   * state. Surfaced as the MCP `destructiveHint` annotation. Left
   * `undefined` only for tools that have not been classified — the
   * shared dispatch then omits the hint so the spec default (`true`,
   * the safe side) applies.
   */
  destructive?: boolean
  /**
   * `true` when the tool only reads and never mutates state. Surfaced
   * as the MCP `readOnlyHint` annotation.
   */
  readOnly?: boolean
}

export const tools: ToolDefinition[] = [
  {
    name: 'list_posts',
    description:
      'Returns lightweight post summaries (no body — use get_post for content) with search / sort / filters. `total` reflects the filtered count. Supports query (substring over title/slug/tags), tag (exact), status, sort, limit (1–100, default 20), offset (default 0).',
    inputSchema: listPostsSchema,
    handler: (args, ctx) => listPosts(ctx.graphql, args),
    readOnly: true,
    destructive: false,
  },
  {
    name: 'get_post',
    description:
      'Fetch a single post by slug or postId. Returns null if not found.',
    inputSchema: getPostSchema,
    handler: (args, ctx) => getPost(ctx.graphql, args),
    readOnly: true,
    destructive: false,
  },
  {
    name: 'create_post',
    description:
      'Create a new post. Title and slug are required. Body shape depends on format: tiptap=JSON node tree, markdown=source string, html=raw HTML string. Defaults to status=draft. Pass `metadata: { no_layout: true }` alongside format=html to publish the body as a bare HTML page with no theme chrome (middleware rewrites the /<slug> request to the internal bare-HTML handler). Pass `metadata: { cache: "deep" | "hot" }` to override the default cooldown-based cache strategy — see get_schema.notes.cacheStrategy for details.',
    inputSchema: createPostSchema,
    handler: (args, ctx) =>
      createPost(ctx.graphql, args as unknown as Parameters<typeof createPost>[1]),
    readOnly: false,
    destructive: false,
  },
  {
    name: 'update_post',
    description:
      'Update an existing post by postId. Only the fields you pass are changed. Tag list / publishedAt changes also update the PostTag denormalized index. Passing `metadata` REPLACES the existing object — call get_post first if you only want to add or change one key.',
    inputSchema: updatePostSchema,
    handler: (args, ctx) =>
      updatePost(ctx.graphql, args as unknown as Parameters<typeof updatePost>[1]),
    readOnly: false,
    // Overwrites an existing post's fields — not a pure additive write.
    destructive: true,
  },
  {
    name: 'delete_post',
    description:
      'Delete a post by postId. Also drops associated PostTag index entries.',
    inputSchema: deletePostSchema,
    handler: (args, ctx) =>
      deletePost(ctx.graphql, args as unknown as Parameters<typeof deletePost>[1]),
    readOnly: false,
    destructive: true,
  },
  {
    name: 'upload_media',
    description:
      'Upload a file to the site\'s media S3 bucket. Pass base64-encoded bytes; the server stores them verbatim under public/media/YYYY/MM/. Returns the public URL and Media record. The server does not transcode — pre-process (e.g. resize/webp) on the client.',
    inputSchema: uploadMediaSchema,
    handler: (args, ctx) =>
      uploadMedia(ctx.graphql, ctx.storage(), args as unknown as Parameters<typeof uploadMedia>[2]),
    readOnly: false,
    destructive: false,
  },
  {
    name: 'list_media',
    description:
      'List media files in the CMS. Optional filters: `mimeType` (prefix match — "image/" matches all images, "image/png" only PNG), `prefix` (S3 key prefix on `src`, e.g. "public/media/2024/"), `createdAfter` / `createdBefore` (ISO 8601 date range). Returns up to `limit` rows (default 20) — each `{ mediaId, src, url, mimeType, size, createdAt, updatedAt }` — plus a `nextToken` cursor. Note: filters apply after the page read, so a page may return fewer than `limit` rows while a `nextToken` remains — follow the cursor. Use this to find media to delete without remembering `upload_media` responses.',
    inputSchema: listMediaSchema,
    handler: (args, ctx) =>
      listMedia(ctx.graphql, ctx.storage(), args as unknown as Parameters<typeof listMedia>[2]),
    readOnly: true,
    destructive: false,
  },
  {
    name: 'search_media',
    description:
      'Search media by substring (case-sensitive `contains`) across `src` (which includes the filename) and `mimeType`. Pass `query` (e.g. "logo", ".png", "image/png"). Walks DynamoDB pages internally until it collects at least `limit` matches (default 20), exhausts the table, or hits its page cap — so `limit` is a soft target and the result may run slightly past it. Returns the same row shape as `list_media` plus `nextToken`; `truncated: true` means the page cap was hit with more to scan (pass `nextToken` back to continue).',
    inputSchema: searchMediaSchema,
    handler: (args, ctx) =>
      searchMedia(ctx.graphql, ctx.storage(), args as unknown as Parameters<typeof searchMedia>[2]),
    readOnly: true,
    destructive: false,
  },
  {
    name: 'delete_media',
    description:
      'Delete a media file: removes the S3 object and the Media row. Pass `mediaId` (from `upload_media`\'s response, or `list_media` / `search_media`) or `src` (full S3 key like `public/media/2026/05/...`). When only `src` is given, looks up the Media row via `getMediaBySrc`. S3 delete runs first, then the DDB row delete — both are idempotent so re-running converges on missing-key cases. Pass `dryRun: true` to preview what would be deleted without touching anything (returns `{ deleted: false, dryRun: true, ... }`). Returns `{ deleted: false }` instead of throwing when no Media row matches; if `src` was supplied directly the S3 object is still removed (use this to sweep orphan files).',
    inputSchema: deleteMediaSchema,
    handler: (args, ctx) =>
      deleteMedia(
        ctx.graphql,
        ctx.storage(),
        args as unknown as Parameters<typeof deleteMedia>[2],
      ),
    readOnly: false,
    destructive: true,
  },
  {
    name: 'get_schema',
    description:
      'Returns the CMS content schema (Post/Page/Media field shapes, format enum, notes). Useful as the first call to understand what fields are available.',
    inputSchema: getSchemaSchema,
    handler: async () => getSchema(),
    readOnly: true,
    destructive: false,
  },
  {
    name: 'upload_static_bundle',
    description:
      "Create or replace a `format: 'static'` post in one shot. Pass a base64-encoded zip; the server unpacks it, validates every path + lints HTML/CSS/SVG for absolute path refs (bundles must be self-contained via relative paths), wipes the existing S3 prefix at public/static/<slug>/, uploads every file, and upserts the Post row with a manifest pointing at the entrypoint. Use this when you have the whole bundle to submit at once. For incremental edits use upload_static_file / delete_static_file followed by commit_static_post.",
    inputSchema: uploadStaticBundleSchema,
    handler: (args, ctx) =>
      uploadStaticBundle(
        ctx.graphql,
        ctx.storage(),
        args as unknown as Parameters<typeof uploadStaticBundle>[2],
      ),
    readOnly: false,
    destructive: true,
  },
  {
    name: 'upload_static_file',
    description:
      "Upload a single file into an existing static bundle's S3 prefix. The Post row is NOT modified — its `body` manifest will be out of sync with the prefix until you call `commit_static_post`. Use this for incremental edits (one CSS swap, single image change) where rebuilding the entire zip would be overkill. Text files (HTML/CSS/SVG) are linted for absolute / protocol-relative URL refs the same as the zip flow.",
    inputSchema: uploadStaticFileSchema,
    handler: (args, ctx) =>
      uploadStaticFile(
        ctx.storage(),
        args as unknown as Parameters<typeof uploadStaticFile>[1],
      ),
    readOnly: false,
    // Overwrites whatever file currently sits at that S3 key.
    destructive: true,
  },
  {
    name: 'delete_static_file',
    description:
      "Delete a single file from a static bundle's S3 prefix. The Post row is NOT modified — its `body` manifest will list the deleted file until you call `commit_static_post`. Idempotent: returns `{ deleted: false }` instead of throwing if the file isn't there.",
    inputSchema: deleteStaticFileSchema,
    handler: (args, ctx) =>
      deleteStaticFile(
        ctx.storage(),
        args as unknown as Parameters<typeof deleteStaticFile>[1],
      ),
    readOnly: false,
    destructive: true,
  },
  {
    name: 'commit_static_post',
    description:
      'Rebuild a static post\'s Post row from whatever is currently in its S3 prefix. Scans `public/static/<slug>/`, picks the entrypoint (default `index.html` or override), and upserts the Post with a fresh manifest (sorted file list + uploadedAt timestamp). Use this as the "save" step after a series of `upload_static_file` / `delete_static_file` calls. `title` is required when creating a brand-new post; on update, existing fields are preserved unless explicitly overridden.',
    inputSchema: commitStaticPostSchema,
    handler: (args, ctx) =>
      commitStaticPost(
        ctx.graphql,
        ctx.storage(),
        args as unknown as Parameters<typeof commitStaticPost>[2],
      ),
    readOnly: false,
    // Rebuilds (overwrites) the existing Post row's manifest.
    destructive: true,
  },
]

/**
 * Look up a tool definition by name and invoke its handler. Returns
 * `null` when no tool with that name is registered — callers should
 * surface that as a JSON-RPC "method not found" error.
 */
export async function dispatchToolCall(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<unknown> {
  const tool = tools.find((t) => t.name === name)
  if (!tool) return null
  return tool.handler(args, ctx)
}

/**
 * `tools` is the canonical registry; `getTools()` returns it for
 * callers that prefer a function over a top-level constant (admin's
 * HTTP factory exposes this through its options shape).
 */
export function getTools(): readonly ToolDefinition[] {
  return tools
}
