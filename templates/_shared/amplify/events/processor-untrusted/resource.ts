import { defineFunction } from '@aws-amplify/backend'

export const processorUntrusted = defineFunction({
  name: 'processor-untrusted',
  entry: './handler.ts',
  runtime: 22,
  // Untrusted plugins do pure JS work; modest memory.
  memoryMB: 256,
  timeoutSeconds: 30,
  // Pin to the data stack so all event-system Lambdas live together
  // (dispatcher / processor-trusted are also `data`) and the function
  // stack doesn't bridge data ↔ storage ↔ auth in a CFN cycle.
  resourceGroupName: 'data',
})
