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
      delivery: a.enum(['nextjs', 's3-direct']),
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
})

export type Schema = ClientSchema<typeof schema>
export const data = defineData({ schema })
