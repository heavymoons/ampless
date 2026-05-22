import type { GraphqlClient } from './types.js'
import { POST_FIELDS, toCorePost } from './post-mapping.js'

const GET_BY_ID = /* GraphQL */ `
  ${POST_FIELDS}
  query GetPost($postId: ID!) {
    getPost(postId: $postId) {
      ...PostFields
    }
  }
`

const LIST_BY_SLUG = /* GraphQL */ `
  ${POST_FIELDS}
  query GetPostBySlug($filter: ModelPostFilterInput!) {
    listPosts(filter: $filter, limit: 1) {
      items {
        ...PostFields
      }
    }
  }
`

export interface GetPostArgs {
  slug?: string
  postId?: string
}

export const getPostSchema = {
  type: 'object',
  properties: {
    slug: { type: 'string', description: 'Post slug' },
    postId: { type: 'string', description: 'Post id (used when slug is omitted)' },
  },
} as const

export async function getPost(client: GraphqlClient, args: GetPostArgs) {
  if (!args.slug && !args.postId) {
    throw new Error('get_post requires either `slug` or `postId`')
  }

  if (args.postId) {
    const data = await client.query<{
      getPost: Parameters<typeof toCorePost>[0] | null
    }>(GET_BY_ID, { postId: args.postId })
    return data.getPost ? toCorePost(data.getPost) : null
  }

  const data = await client.query<{
    listPosts: { items: Parameters<typeof toCorePost>[0][] }
  }>(LIST_BY_SLUG, {
    filter: { slug: { eq: args.slug } },
  })
  const item = data.listPosts.items[0]
  return item ? toCorePost(item) : null
}
