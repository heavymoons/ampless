import type { GraphqlClient } from './types.js'

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
  const data = await client.query<{
    deletePost: { postId: string }
  }>(MUTATION, { input: { postId: args.postId } })

  // PostTag denormalized index is dropped by the trusted-processor
  // Lambda from the Post DynamoDB stream (REMOVE event carries the
  // old image, which the processor uses to derive the entries to
  // delete).
  return { deleted: data.deletePost }
}
