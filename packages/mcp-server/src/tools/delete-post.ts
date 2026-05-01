import type { GraphqlClient } from '../appsync.js'
import { syncPostTags } from '../posttag.js'
import { getPost } from './get-post.js'

const MUTATION = /* GraphQL */ `
  mutation DeletePost($input: DeletePostInput!) {
    deletePost(input: $input) {
      siteId
      postId
    }
  }
`

export interface DeletePostArgs {
  postId: string
  siteId?: string
}

export const deletePostSchema = {
  type: 'object',
  required: ['postId'],
  properties: {
    postId: { type: 'string' },
    siteId: { type: 'string', description: 'Site identifier (defaults to "default")' },
  },
} as const

export async function deletePost(
  client: GraphqlClient,
  defaultSiteId: string,
  args: DeletePostArgs
): Promise<{ deleted: { siteId: string; postId: string } }> {
  const siteId = args.siteId ?? defaultSiteId

  const oldPost = await getPost(client, defaultSiteId, { postId: args.postId, siteId })
  if (oldPost) {
    // Drop PostTag entries before the post itself disappears.
    await syncPostTags(client, { ...oldPost, status: 'draft' }, oldPost)
  }

  const data = await client.query<{
    deletePost: { siteId: string; postId: string }
  }>(MUTATION, { input: { siteId, postId: args.postId } })

  return { deleted: data.deletePost }
}
