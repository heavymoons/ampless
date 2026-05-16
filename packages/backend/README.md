# @ampless/backend

Amplify Gen 2 backend factories for [ampless](https://github.com/heavymoons/ampless). Bundles the IAM / SQS / DynamoDB-stream wiring, the auth / data / storage definitions, and every event-processing Lambda behind one `defineAmplessBackend(...)` factory.

> **Pre-release / alpha.** Breaking changes possible in any minor version until v1.0.

Splitting this out of the template lets you `npm update @ampless/backend` without re-running the scaffolder. Backend bug fixes and infrastructure improvements arrive through the package; the user-side `amplify/` tree becomes a handful of 1–5 line shells that compose the factories.

## Install

```bash
npm install @ampless/backend@alpha ampless@alpha
```

Peer dependencies: `@aws-amplify/backend` (^1), `aws-cdk-lib` (^2). The CLI scaffolder pins compatible versions in the template's `package.json`.

## Usage

### `amplify/backend.ts`

```ts
import { defineAmplessBackend } from '@ampless/backend'
import { auth } from './auth/resource'
import { data } from './data/resource'
import { storage } from './storage/resource'
import { postConfirmation } from './auth/post-confirmation/resource'
import { eventDispatcher } from './events/dispatcher/resource'
import { processorTrusted } from './events/processor-trusted/resource'
import { processorUntrusted } from './events/processor-untrusted/resource'
import { apiKeyRenewer } from './functions/api-key-renewer/resource'

export default defineAmplessBackend({
  auth, data, storage, postConfirmation,
  eventDispatcher, processorTrusted, processorUntrusted, apiKeyRenewer,
})
```

### `amplify/auth/resource.ts`

```ts
import { defineAmplessAuth } from '@ampless/backend'
import { postConfirmation } from './post-confirmation/resource'

export const auth = defineAmplessAuth({ postConfirmation })
```

### `amplify/data/resource.ts`

```ts
import { a, defineData, type ClientSchema } from '@aws-amplify/backend'
import { amplessSchemaModels, defaultAuthorizationModes } from '@ampless/backend'

const schema = a.schema({
  ...amplessSchemaModels(a),
  // Add custom models here — they live alongside the built-ins:
  // MyCustomModel: a.model({ ... }).authorization((allow) => [...]),
})

export type Schema = ClientSchema<typeof schema>
export const data = defineData({ schema, authorizationModes: defaultAuthorizationModes })
```

The three AppSync JS resolver files (`list-published-posts.js`, `get-published-post.js`, `list-posts-by-tag.js`) stay in the template — AppSync resolves resolver `entry` paths at CDK synth time relative to the file that calls `defineData`, and pnpm-symlinked `node_modules` paths don't survive that resolution. If you move them out of `amplify/data/`, pass new paths through `amplessSchemaModels(a, { resolverPaths })`.

### `amplify/storage/resource.ts`

```ts
import { defineAmplessStorage } from '@ampless/backend'
export const storage = defineAmplessStorage()
```

### Lambda thin shells

Every handler file in `amplify/auth/`, `amplify/events/`, and `amplify/functions/` becomes a 1–3 line re-export. Amplify's esbuild follows the import into this package and bundles the real handler code into the Lambda artifact.

```ts
// amplify/auth/post-confirmation/handler.ts
export { handler } from '@ampless/backend/auth/post-confirmation'

// amplify/events/dispatcher/handler.ts
export { handler } from '@ampless/backend/events/dispatcher'

// amplify/events/processor-trusted/handler.ts
import config from '../../../cms.config'
import { createProcessorTrustedHandler } from '@ampless/backend/events/processor-trusted'
export const handler = createProcessorTrustedHandler({
  plugins: config.plugins,
  site: config.site,
})

// amplify/events/processor-untrusted/handler.ts
import config from '../../../cms.config'
import { createProcessorUntrustedHandler } from '@ampless/backend/events/processor-untrusted'
export const handler = createProcessorUntrustedHandler({
  plugins: config.plugins,
  site: config.site,
})

// amplify/functions/api-key-renewer/handler.ts
export { handler } from '@ampless/backend/functions/api-key-renewer'
```

## Sub-paths

- `@ampless/backend` — `defineAmplessBackend`, `defineAmplessAuth`, `defineAmplessStorage`, `amplessSchemaModels`, `extendAmplessSchema`, `defaultAuthorizationModes`
- `@ampless/backend/auth/post-confirmation` — Lambda handler
- `@ampless/backend/events/dispatcher` — Lambda handler
- `@ampless/backend/events/processor-trusted` — `createProcessorTrustedHandler({ plugins, site })`
- `@ampless/backend/events/processor-untrusted` — `createProcessorUntrustedHandler({ plugins, site })`
- `@ampless/backend/functions/api-key-renewer` — Lambda handler

## What's still in the template

- `amplify/data/*.js` — AppSync JS resolvers (file-path constraint).
- Every `resource.ts` and `handler.ts` — they're thin shells, but they hold the `entry: './handler.ts'` paths that Amplify's CDK synth resolves on the user side.
- `cms.config.ts` and `themes-registry.ts` — user-owned customisation surface.
- Theme components under `templates/<theme>/` — user-owned.

## License

MIT
