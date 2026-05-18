import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { a, defineData, type ClientSchema } from '@aws-amplify/backend'
import { amplessSchemaModels, defaultAuthorizationModes } from '@ampless/backend'

// AppSync's `a.handler.custom({ entry })` paths are resolved by CDK
// relative to the file that called `a.handler.custom`. When the call
// originates inside `@ampless/backend` (via amplessSchemaModels), the
// CDK synth tries to resolve `./list-published-posts.js` relative to
// `node_modules/@ampless/backend/dist/index.js` and fails with
// `UnresolvedEntryPathError`. Anchor the resolver paths at THIS file's
// directory so the result is unambiguous.
const __dirname = dirname(fileURLToPath(import.meta.url))

// Ampless's built-in models (Post / Page / Media / Taxonomy / PostTag /
// KvStore) plus the three public-read custom queries
// (listPublishedPosts / getPublishedPost / listPostsByTag).
//
// Add project-specific models alongside the spread:
//
//   const schema = a.schema({
//     ...amplessSchemaModels(a, { resolverPaths }),
//     MyCustomModel: a
//       .model({ siteId: a.string().required(), foo: a.string() })
//       .identifier(['siteId', 'foo'])
//       .authorization((allow) => [allow.groups(['ampless-admin'])]),
//   })
const resolverPaths = {
  listPublishedPosts: resolve(__dirname, 'list-published-posts.js'),
  getPublishedPost: resolve(__dirname, 'get-published-post.js'),
  listPostsByTag: resolve(__dirname, 'list-posts-by-tag.js'),
}

const schema = a.schema({
  ...amplessSchemaModels(a, { resolverPaths }),
})

export type Schema = ClientSchema<typeof schema>
export const data = defineData({
  schema,
  authorizationModes: defaultAuthorizationModes,
})
