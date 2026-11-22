// Test-only fixture: the nine ampless Lambdas as Amplify "provided"
// functions (`defineFunction((scope) => new Function(...))`) with inline
// code, so synthesizing a full backend in vitest skips the esbuild
// bundling of the real handlers. Resource groups mirror the templates'
// `amplify/**/resource.ts` so the nested-stack layout (and the circular
// dependency avoidance it exists for) matches a real site.
//
// Not part of the published package: tsup only builds the entries in
// tsup.config.ts and package.json `files` ships `dist` only.

import { defineFunction } from '@aws-amplify/backend'
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda'

type ResourceGroup = 'auth' | 'data'

// Factories are typed `unknown` (as in DefineAmplessBackendOpts): Amplify's
// factory types reference pnpm-internal paths that declaration emit can't
// name.
function inlineFunction(id: string, resourceGroupName: ResourceGroup): unknown {
  return defineFunction(
    (scope) =>
      new Function(scope, id, {
        runtime: Runtime.NODEJS_22_X,
        handler: 'index.handler',
        code: Code.fromInline('exports.handler = async () => {}'),
      }),
    { resourceGroupName }
  )
}

export interface FixtureFunctions {
  postConfirmation: unknown
  eventDispatcher: unknown
  processorTrusted: unknown
  processorUntrusted: unknown
  apiKeyRenewer: unknown
  userAdmin: unknown
  mcpHandler: unknown
  pluginSecretHandler: unknown
}

export function makeFunctions(): FixtureFunctions {
  return {
    postConfirmation: inlineFunction('post-confirmation', 'auth'),
    eventDispatcher: inlineFunction('event-dispatcher', 'data'),
    processorTrusted: inlineFunction('processor-trusted', 'data'),
    processorUntrusted: inlineFunction('processor-untrusted', 'data'),
    apiKeyRenewer: inlineFunction('api-key-renewer', 'data'),
    userAdmin: inlineFunction('user-admin', 'data'),
    mcpHandler: inlineFunction('mcp-handler', 'data'),
    pluginSecretHandler: inlineFunction('plugin-secret-handler', 'data'),
  }
}
