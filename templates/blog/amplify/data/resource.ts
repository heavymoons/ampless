import { a, defineData, type ClientSchema } from '@aws-amplify/backend'

const schema = a.schema({
  Post: a
    .model({
      siteId: a.string().required(),
      postId: a.id().required(),
      slug: a.string().required(),
      title: a.string().required(),
      excerpt: a.string(),
      format: a.enum(['tiptap', 'markdown', 'html']),
      body: a.json(),
      status: a.enum(['draft', 'published']),
      publishedAt: a.datetime(),
      tags: a.string().array(),
    })
    .identifier(['siteId', 'postId'])
    // Secondary index on `status` + `publishedAt` so the public read
    // resolvers can fetch only published posts efficiently.
    .secondaryIndexes((index) => [
      index('status').sortKeys(['publishedAt']).name('byStatus'),
    ])
    // Direct table access is admin/editor only — guests must go through
    // the custom queries below, which strip drafts at the resolver level.
    .authorization((allow) => [allow.groups(['ampless-admin', 'ampless-editor'])]),

  Page: a
    .model({
      siteId: a.string().required(),
      pageId: a.id().required(),
      slug: a.string().required(),
      title: a.string().required(),
      format: a.enum(['tiptap', 'markdown', 'html']),
      body: a.json(),
      status: a.enum(['draft', 'published']),
      publishedAt: a.datetime(),
    })
    .identifier(['siteId', 'pageId'])
    .authorization((allow) => [allow.groups(['ampless-admin', 'ampless-editor'])]),

  Media: a
    .model({
      siteId: a.string().required(),
      mediaId: a.id().required(),
      src: a.string().required(),
      mimeType: a.string().required(),
      size: a.integer(),
      delivery: a.string(),
    })
    .identifier(['siteId', 'mediaId'])
    .authorization((allow) => [allow.groups(['ampless-admin', 'ampless-editor'])]),

  Taxonomy: a
    .model({
      siteId: a.string().required(),
      termId: a.id().required(),
      type: a.enum(['category', 'tag']),
      name: a.string().required(),
      slug: a.string().required(),
    })
    .identifier(['siteId', 'termId'])
    .authorization((allow) => [allow.groups(['ampless-admin', 'ampless-editor'])]),

  // Denormalized index for "posts by tag" queries. Each Post tag becomes
  // one PostTag row, so listing/filtering by tag is a single Query —
  // including date-range archive views, since publishedAt is part of the
  // sort key. Maintained by the admin client whenever a post is created,
  // updated, or deleted; never edited by end users.
  //
  //   PK: siteIdTag         e.g. "default#tech"
  //   SK: publishedAtPostId e.g. "2026-04-27T13:57:05.679Z#post-001"
  PostTag: a
    .model({
      siteIdTag: a.string().required(),
      publishedAtPostId: a.string().required(),
      siteId: a.string().required(),
      tag: a.string().required(),
      postId: a.id().required(),
      publishedAt: a.datetime().required(),
      slug: a.string().required(),
      title: a.string().required(),
      excerpt: a.string(),
      // Full tag list of the post (for chip rendering on tag pages).
      tags: a.string().array(),
    })
    .identifier(['siteIdTag', 'publishedAtPostId'])
    .authorization((allow) => [allow.groups(['ampless-admin', 'ampless-editor'])]),

  // Custom return type for public post reads. Decoupling from `Post` lets
  // AppSync skip the model-level (admin-only) auth check on fields.
  PublicPost: a.customType({
    siteId: a.string().required(),
    postId: a.id().required(),
    slug: a.string().required(),
    title: a.string().required(),
    excerpt: a.string(),
    format: a.string(),
    body: a.json(),
    status: a.string(),
    publishedAt: a.datetime(),
    tags: a.string().array(),
  }),

  // Paginated wrapper for list responses.
  PublicPostConnection: a.customType({
    items: a.ref('PublicPost').array(),
    nextToken: a.string(),
  }),

  // Public read endpoints — guard against draft leakage via custom resolvers.
  // Custom handlers only support apiKey / userPool / lambda auth, so we use
  // a public API key for unauthenticated visitors.
  listPublishedPosts: a
    .query()
    .arguments({
      siteId: a.string(),
      // Both ISO 8601 strings; query SK condition is pushed into DynamoDB
      // so only the matching publishedAt range is read.
      from: a.datetime(),
      to: a.datetime(),
      limit: a.integer(),
      // Opaque DynamoDB pagination cursor. Pass back the previous response's
      // `nextToken` to fetch the next page.
      nextToken: a.string(),
    })
    .returns(a.ref('PublicPostConnection'))
    .handler(
      a.handler.custom({
        dataSource: a.ref('Post'),
        entry: './list-published-posts.js',
      })
    )
    .authorization((allow) => [
      allow.publicApiKey(),
      allow.authenticated(),
      allow.groups(['ampless-admin', 'ampless-editor']),
    ]),

  getPublishedPost: a
    .query()
    .arguments({ siteId: a.string(), slug: a.string().required() })
    .returns(a.ref('PublicPost'))
    .handler(
      a.handler.custom({
        dataSource: a.ref('Post'),
        entry: './get-published-post.js',
      })
    )
    .authorization((allow) => [
      allow.publicApiKey(),
      allow.authenticated(),
      allow.groups(['ampless-admin', 'ampless-editor']),
    ]),

  // Tag pages: newest-first only. Archive (date range) within a tag is not
  // a common UX pattern; if it's ever needed, add `from`/`to` args here.
  listPostsByTag: a
    .query()
    .arguments({
      siteId: a.string(),
      tag: a.string().required(),
      limit: a.integer(),
      nextToken: a.string(),
    })
    .returns(a.ref('PublicPostConnection'))
    .handler(
      a.handler.custom({
        dataSource: a.ref('PostTag'),
        entry: './list-posts-by-tag.js',
      })
    )
    .authorization((allow) => [
      allow.publicApiKey(),
      allow.authenticated(),
      allow.groups(['ampless-admin', 'ampless-editor']),
    ]),
})

export type Schema = ClientSchema<typeof schema>
export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
    apiKeyAuthorizationMode: { expiresInDays: 365 },
  },
})
