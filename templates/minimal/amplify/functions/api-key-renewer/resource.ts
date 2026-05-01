import { defineFunction } from '@aws-amplify/backend'

export const apiKeyRenewer = defineFunction({
  name: 'api-key-renewer',
  entry: './handler.ts',
  // Co-locate with the data stack — the function reads/updates the
  // AppSync API's API key, so being in the same stack avoids a CFN
  // dependency cycle between data, function, and auth.
  resourceGroupName: 'data',
  memoryMB: 256,
  timeoutSeconds: 30,
})
