// @ampless/backend — Amplify Gen 2 backend factories for ampless.
//
// Templates wire this up at `amplify/backend.ts`:
//
//     import { defineAmplessBackend } from '@ampless/backend'
//     import { auth } from './auth/resource'
//     import { data } from './data/resource'
//     import { storage } from './storage/resource'
//     import { postConfirmation } from './auth/post-confirmation/resource'
//     import { eventDispatcher } from './events/dispatcher/resource'
//     import { processorTrusted } from './events/processor-trusted/resource'
//     import { processorUntrusted } from './events/processor-untrusted/resource'
//     import { apiKeyRenewer } from './functions/api-key-renewer/resource'
//
//     export default defineAmplessBackend({
//       auth, data, storage, postConfirmation,
//       eventDispatcher, processorTrusted, processorUntrusted, apiKeyRenewer,
//     })
//
// `amplify/{auth,data,storage}/resource.ts` MUST call the Amplify
// factory (`defineAuth` / `defineData` / `defineStorage`) directly,
// not through a wrapper in this package. Amplify Gen 2's import-path
// verifier inspects the second stack frame and requires those calls
// to originate from the user's `amplify/{auth,data,storage}/resource.ts`;
// routing through `node_modules/@ampless/backend/...` trips the guard.
// So this package exposes config-builder helpers (`amplessAuthConfig`,
// `amplessStorageConfig`, `amplessSchemaModels`, ...) that return
// plain options objects which the user spreads into the Amplify
// factory call themselves.
//
// Lambda `handler.ts` thin shells re-export `handler` from one of the
// subpath entries (so Amplify's esbuild bundles this package into the
// Lambda).
//
// The AppSync JS resolvers (`amplify/data/*.js`) stay user-owned —
// AppSync resolves `entry: './...'` paths at CDK synth time relative
// to the file that calls `defineData`, and node_modules paths through
// pnpm symlinks have proven brittle for that resolver. Templates ship
// the three resolver files unchanged.

export { defineAmplessBackend } from './backend.js'
export type { DefineAmplessBackendOpts, AmplessBackend } from './backend.js'

export { amplessAuthConfig } from './auth/index.js'
export type { AmplessAuthConfigOpts, AmplessWebAuthnOption } from './auth/index.js'

export { amplessStorageConfig } from './storage/index.js'

export {
  amplessSchemaModels,
  amplessSchemaAuthorization,
  extendAmplessSchema,
  defaultAuthorizationModes,
  DEFAULT_RESOLVER_PATHS,
} from './data/index.js'
export type {
  AmplessSchemaModelsOpts,
  AmplessSchemaAuthorizationOpts,
  AmplessResolverPaths,
} from './data/index.js'
