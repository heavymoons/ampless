import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { a, defineData, type ClientSchema } from '@aws-amplify/backend'
import { amplessSchemaModels, defaultAuthorizationModes } from '@ampless/backend'
import { userAdmin } from '../functions/user-admin/resource.js'
import { mcpHandler } from '../functions/mcp-handler/resource.js'
import { customSchemaModels } from './resource.custom.js'

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
// Add project-specific models in `amplify/data/resource.custom.ts` —
// that file is never overwritten by `create-ampless upgrade`.
const resolverPaths = {
  listPublishedPosts: resolve(__dirname, 'list-published-posts.js'),
  getPublishedPost: resolve(__dirname, 'get-published-post.js'),
  listPostsByTag: resolve(__dirname, 'list-posts-by-tag.js'),
}

const schema = a.schema({
  ...amplessSchemaModels(a, {
    resolverPaths,
    userAdminFunction: userAdmin,
    // Grants the MCP Lambda IAM auth on Post / PostTag so the HTTP
    // transport can dispatch the post CRUD tools without sharing a
    // Cognito identity or API key. See `@ampless/backend` data/index.ts
    // for the exact authorization clause.
    mcpHandlerFunction: mcpHandler,
  }),
  ...customSchemaModels(a),
})

export type Schema = ClientSchema<typeof schema>
export const data = defineData({
  schema,
  authorizationModes: defaultAuthorizationModes,
})
