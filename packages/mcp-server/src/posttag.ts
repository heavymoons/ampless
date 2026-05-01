// PostTag denormalized index sync — mirrors templates/blog/lib/posts-provider.ts
// (Phase 4) but talks to AppSync via raw GraphQL instead of generateClient.
// Each (siteId, tag, post) combination becomes one PostTag row keyed by:
//   PK: `${siteId}#${tag}`
//   SK: `${publishedAt}#${postId}`
// so the public listPostsByTag resolver can do a single Query.

import type { Post } from 'ampless'
import type { GraphqlClient } from './appsync.js'

interface PostTagEntry {
  siteIdTag: string
  publishedAtPostId: string
}

function entries(post: Post): PostTagEntry[] {
  if (post.status !== 'published' || !post.publishedAt || !post.tags?.length) return []
  return post.tags.map((tag) => ({
    siteIdTag: `${post.siteId}#${tag}`,
    publishedAtPostId: `${post.publishedAt}#${post.postId}`,
  }))
}

function entryKey(e: PostTagEntry): string {
  return `${e.siteIdTag}|${e.publishedAtPostId}`
}

const CREATE_POST_TAG = /* GraphQL */ `
  mutation CreatePostTag($input: CreatePostTagInput!) {
    createPostTag(input: $input) {
      siteIdTag
      publishedAtPostId
    }
  }
`

const UPDATE_POST_TAG = /* GraphQL */ `
  mutation UpdatePostTag($input: UpdatePostTagInput!) {
    updatePostTag(input: $input) {
      siteIdTag
      publishedAtPostId
    }
  }
`

const DELETE_POST_TAG = /* GraphQL */ `
  mutation DeletePostTag($input: DeletePostTagInput!) {
    deletePostTag(input: $input) {
      siteIdTag
      publishedAtPostId
    }
  }
`

export async function syncPostTags(
  client: GraphqlClient,
  post: Post,
  oldPost: Post | null
): Promise<void> {
  const oldEntries = oldPost ? entries(oldPost) : []
  const newEntries = entries(post)

  const oldKeys = new Set(oldEntries.map(entryKey))
  const newKeys = new Set(newEntries.map(entryKey))

  // Remove entries that no longer apply.
  await Promise.all(
    oldEntries
      .filter((e) => !newKeys.has(entryKey(e)))
      .map((e) =>
        client.query(DELETE_POST_TAG, {
          input: { siteIdTag: e.siteIdTag, publishedAtPostId: e.publishedAtPostId },
        })
      )
  )

  // Add brand-new entries.
  await Promise.all(
    newEntries
      .filter((e) => !oldKeys.has(entryKey(e)))
      .map((e) =>
        client.query(CREATE_POST_TAG, {
          input: {
            siteIdTag: e.siteIdTag,
            publishedAtPostId: e.publishedAtPostId,
            siteId: post.siteId,
            tag: e.siteIdTag.slice(post.siteId.length + 1),
            postId: post.postId,
            publishedAt: post.publishedAt,
            slug: post.slug,
            title: post.title,
            excerpt: post.excerpt,
            tags: post.tags ?? [],
          },
        })
      )
  )

  // Refresh display fields on entries whose key didn't change.
  await Promise.all(
    newEntries
      .filter((e) => oldKeys.has(entryKey(e)))
      .map((e) =>
        client.query(UPDATE_POST_TAG, {
          input: {
            siteIdTag: e.siteIdTag,
            publishedAtPostId: e.publishedAtPostId,
            slug: post.slug,
            title: post.title,
            excerpt: post.excerpt,
            tags: post.tags ?? [],
          },
        })
      )
  )
}
