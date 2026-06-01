import { defineFunction } from '@aws-amplify/backend'

// `resourceGroupName: 'data'` co-locates this Lambda with the AppSync
// stack. Required because `setPluginSecret` / `clearPluginSecret` are
// wired as custom GraphQL resolvers (data → function), matching the
// same circular-dependency avoidance used for user-admin.
export const pluginSecretHandler = defineFunction({
  name: 'plugin-secret-handler',
  entry: './handler.ts',
  runtime: 22,
  resourceGroupName: 'data',
})
