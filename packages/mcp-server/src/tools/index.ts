import type { GraphqlClient } from '../appsync.js'
import type { StorageClient } from '../s3.js'

import { listPosts, listPostsSchema } from './list-posts.js'
import { getPost, getPostSchema } from './get-post.js'
import { createPost, createPostSchema } from './create-post.js'
import { updatePost, updatePostSchema } from './update-post.js'
import { deletePost, deletePostSchema } from './delete-post.js'
import { uploadMedia, uploadMediaSchema } from './upload-media.js'
import { getSchema, getSchemaSchema } from './get-schema.js'

export interface ToolContext {
  graphql: GraphqlClient
  storage: () => StorageClient
  defaultSiteId: string
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>
}

export const tools: ToolDefinition[] = [
  {
    name: 'list_posts',
    description:
      'List posts in the CMS with optional filters by status. Returns up to `limit` posts (default 20) plus a `nextToken` cursor for pagination.',
    inputSchema: listPostsSchema,
    handler: (args, ctx) => listPosts(ctx.graphql, ctx.defaultSiteId, args),
  },
  {
    name: 'get_post',
    description:
      'Fetch a single post by slug or postId. Returns null if not found.',
    inputSchema: getPostSchema,
    handler: (args, ctx) => getPost(ctx.graphql, ctx.defaultSiteId, args),
  },
  {
    name: 'create_post',
    description:
      'Create a new post. Title and slug are required. Body shape depends on format: tiptap=JSON node tree, markdown=source string, html=raw HTML string. Defaults to status=draft.',
    inputSchema: createPostSchema,
    handler: (args, ctx) =>
      createPost(ctx.graphql, ctx.defaultSiteId, args as unknown as Parameters<typeof createPost>[2]),
  },
  {
    name: 'update_post',
    description:
      'Update an existing post by postId. Only the fields you pass are changed. Tag list / publishedAt changes also update the PostTag denormalized index.',
    inputSchema: updatePostSchema,
    handler: (args, ctx) =>
      updatePost(ctx.graphql, ctx.defaultSiteId, args as unknown as Parameters<typeof updatePost>[2]),
  },
  {
    name: 'delete_post',
    description:
      'Delete a post by postId. Also drops associated PostTag index entries.',
    inputSchema: deletePostSchema,
    handler: (args, ctx) =>
      deletePost(ctx.graphql, ctx.defaultSiteId, args as unknown as Parameters<typeof deletePost>[2]),
  },
  {
    name: 'upload_media',
    description:
      'Upload a file to the site\'s media S3 bucket. Pass base64-encoded bytes; the server stores them verbatim under public/media/YYYY/MM/. Returns the public URL and Media record. The server does not transcode — pre-process (e.g. resize/webp) on the client.',
    inputSchema: uploadMediaSchema,
    handler: (args, ctx) =>
      uploadMedia(ctx.graphql, ctx.storage(), ctx.defaultSiteId, args as unknown as Parameters<typeof uploadMedia>[3]),
  },
  {
    name: 'get_schema',
    description:
      'Returns the CMS content schema (Post/Page/Media field shapes, format enum, notes). Useful as the first call to understand what fields are available.',
    inputSchema: getSchemaSchema,
    handler: async () => getSchema(),
  },
]
