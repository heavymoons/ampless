// Test-only fixture mirroring templates/_shared/amplify/data/resource.ts.
// `defineData` must be called from a file whose path ends in
// `amplify/data/resource` (Amplify's import-path verifier). Resolver
// entries point at the real template resolver files.
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { a, defineData } from '@aws-amplify/backend'
import {
  amplessSchemaModels,
  amplessSchemaAuthorization,
  defaultAuthorizationModes,
} from '../../../data/index.js'
import type { FixtureFunctions } from '../functions.js'
import { resettableSingleton } from '../singleton.js'

const templateDataDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../templates/_shared/amplify/data'
)

/** Project model standing in for a `resource.custom.ts` addition. */
export const CUSTOM_MODEL_NAME = 'Bookmark'

export const makeData = resettableSingleton((fns: FixtureFunctions): unknown => {
  const schema = a
    .schema({
      ...amplessSchemaModels(a, {
        resolverPaths: {
          listPublishedPosts: resolve(templateDataDir, 'list-published-posts.js'),
          getPublishedPost: resolve(templateDataDir, 'get-published-post.js'),
          listPostsByTag: resolve(templateDataDir, 'list-posts-by-tag.js'),
          getMediaBySrc: resolve(templateDataDir, 'get-media-by-src.js'),
        },
        userAdminFunction: fns.userAdmin,
        pluginSecretHandlerFunction: fns.pluginSecretHandler,
      }),
      [CUSTOM_MODEL_NAME]: a
        .model({
          bookmarkId: a.id().required(),
          url: a.string().required(),
        })
        .identifier(['bookmarkId'])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .authorization((allow: any) => [allow.groups(['ampless-admin'])]),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .authorization((allow: any) =>
      amplessSchemaAuthorization(allow, { mcpHandlerFunction: fns.mcpHandler })
    )

  return defineData({ schema, authorizationModes: defaultAuthorizationModes })
})
