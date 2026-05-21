import { defineFunction } from '@aws-amplify/backend'

export const mcpHandler = defineFunction({
  name: 'mcp-handler',
  entry: './handler.ts',
  // Co-locate with the data stack so the function has the KvStore
  // table ARN available without cross-stack references at synth time.
  resourceGroupName: 'data',
  memoryMB: 512,
  timeoutSeconds: 30,
})
