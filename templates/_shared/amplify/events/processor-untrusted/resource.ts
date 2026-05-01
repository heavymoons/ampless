import { defineFunction } from '@aws-amplify/backend'

export const processorUntrusted = defineFunction({
  name: 'processor-untrusted',
  entry: './handler.ts',
  // Untrusted plugins do pure JS work; modest memory.
  memoryMB: 256,
  timeoutSeconds: 30,
})
