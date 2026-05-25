import { defineFunction } from '@aws-amplify/backend'

export const eventDispatcher = defineFunction({
  name: 'event-dispatcher',
  entry: './handler.ts',
  runtime: 22,
  // Co-locate with the data stack — the function reads the Post table's
  // DynamoDB Stream, so being in the same stack avoids a CloudFormation
  // circular dependency between data, function, and auth.
  resourceGroupName: 'data',
  memoryMB: 256,
  timeoutSeconds: 30,
})
