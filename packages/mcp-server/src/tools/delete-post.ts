import type { GraphqlClient } from './types.js'
import { syncPostTags } from '../posttag.js'
import { getPost } from './get-post.js'

const MUTATION = /* GraphQL */ `
  mutation DeletePost($input: DeletePostInput!) {
    deletePost(input: $input) {
      postId
    }
  }
`

export interface DeletePostArgs {
  postId: string
}

export const deletePostSchema = {
  type: 'object',
  required: ['postId'],
  properties: {
    postId: { type: 'string' },
  },
} as const

export async function deletePost(
  client: GraphqlClient,
  args: DeletePostArgs
): Promise<{ deleted: { postId: string } }> {
  const oldPost = await getPost(client, { postId: args.postId })
  if (oldPost) {
    // Drop PostTag entries before the post itself disappears.
    await syncPostTags(client, { ...oldPost, status: 'draft' }, oldPost)
  }

  const data = await client.query<{
    deletePost: { postId: string }
  }>(MUTATION, { input: { postId: args.postId } })

  return { deleted: data.deletePost }
}
