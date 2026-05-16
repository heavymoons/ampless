import { a, defineData, type ClientSchema } from '@aws-amplify/backend'
import { amplessSchemaModels, defaultAuthorizationModes } from '@ampless/backend'

// Ampless's built-in models (Post / Page / Media / Taxonomy / PostTag /
// KvStore) plus the three public-read custom queries
// (listPublishedPosts / getPublishedPost / listPostsByTag).
//
// Add project-specific models alongside the spread:
//
//   const schema = a.schema({
//     ...amplessSchemaModels(a),
//     MyCustomModel: a
//       .model({ siteId: a.string().required(), foo: a.string() })
//       .identifier(['siteId', 'foo'])
//       .authorization((allow) => [allow.groups(['ampless-admin'])]),
//   })
//
// The three AppSync JS resolvers (`*.js` in this directory) stay
// user-owned — AppSync resolves `entry: './...'` paths at synth time
// relative to this file. If you relocate them, pass new paths via
// `amplessSchemaModels(a, { resolverPaths: { ... } })`.
const schema = a.schema({
  ...amplessSchemaModels(a),
})

export type Schema = ClientSchema<typeof schema>
export const data = defineData({
  schema,
  authorizationModes: defaultAuthorizationModes,
})
