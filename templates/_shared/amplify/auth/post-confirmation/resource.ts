import { defineFunction } from '@aws-amplify/backend'

export const postConfirmation = defineFunction({
  name: 'post-confirmation',
  entry: './handler.ts',
  runtime: 22,
  // Auth trigger — assign to the auth nested stack so CFN doesn't
  // place it in a separate `function` stack that ends up in a
  // circular dependency loop with auth (which references this
  // function) and storage/data (which auth happens to reach via
  // cross-stack refs the function adds).
  resourceGroupName: 'auth',
})
