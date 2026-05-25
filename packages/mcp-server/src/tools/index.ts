import type { ToolContext } from './types.js'

import { listPosts, listPostsSchema } from './list-posts.js'
import { getPost, getPostSchema } from './get-post.js'
import { createPost, createPostSchema } from './create-post.js'
import { updatePost, updatePostSchema } from './update-post.js'
import { deletePost, deletePostSchema } from './delete-post.js'
import { uploadMedia, uploadMediaSchema } from './upload-media.js'
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

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>
  destructive?: boolean
}

export const tools: ToolDefinition[] = [
  {
    name: 'list_posts',
    description:
      'List posts in the CMS with optional filters by status. Returns up to `limit` posts (default 20) plus a `nextToken` cursor for pagination.',
    inputSchema: listPostsSchema,
    handler: (args, ctx) => listPosts(ctx.graphql, args),
  },
  {
    name: 'get_post',
    description:
      'Fetch a single post by slug or postId. Returns null if not found.',
    inputSchema: getPostSchema,
    handler: (args, ctx) => getPost(ctx.graphql, args),
  },
  {
    name: 'create_post',
    description:
      'Create a new post. Title and slug are required. Body shape depends on format: tiptap=JSON node tree, markdown=source string, html=raw HTML string. Defaults to status=draft. Pass `metadata: { no_layout: true }` alongside format=html to publish the body as a bare HTML page with no theme chrome (middleware rewrites the /<slug> request to the internal bare-HTML handler). Pass `metadata: { cache: "deep" | "hot" }` to override the default cooldown-based cache strategy — see get_schema.notes.cacheStrategy for details.',
    inputSchema: createPostSchema,
    handler: (args, ctx) =>
      createPost(ctx.graphql, args as unknown as Parameters<typeof createPost>[1]),
  },
  {
    name: 'update_post',
    description:
      'Update an existing post by postId. Only the fields you pass are changed. Tag list / publishedAt changes also update the PostTag denormalized index. Passing `metadata` REPLACES the existing object — call get_post first if you only want to add or change one key.',
    inputSchema: updatePostSchema,
    handler: (args, ctx) =>
      updatePost(ctx.graphql, args as unknown as Parameters<typeof updatePost>[1]),
  },
  {
    name: 'delete_post',
    description:
      'Delete a post by postId. Also drops associated PostTag index entries.',
    inputSchema: deletePostSchema,
    handler: (args, ctx) =>
      deletePost(ctx.graphql, args as unknown as Parameters<typeof deletePost>[1]),
    destructive: true,
  },
  {
    name: 'upload_media',
    description:
      'Upload a file to the site\'s media S3 bucket. Pass base64-encoded bytes; the server stores them verbatim under public/media/YYYY/MM/. Returns the public URL and Media record. The server does not transcode — pre-process (e.g. resize/webp) on the client.',
    inputSchema: uploadMediaSchema,
    handler: (args, ctx) =>
      uploadMedia(ctx.graphql, ctx.storage(), args as unknown as Parameters<typeof uploadMedia>[2]),
  },
  {
    name: 'get_schema',
    description:
      'Returns the CMS content schema (Post/Page/Media field shapes, format enum, notes). Useful as the first call to understand what fields are available.',
    inputSchema: getSchemaSchema,
    handler: async () => getSchema(),
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
