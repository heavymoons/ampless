import { defineFunction } from '@aws-amplify/backend'

export const processorTrusted = defineFunction({
  name: 'processor-trusted',
  entry: './handler.ts',
  runtime: 22,
  // Co-locate with data — this Lambda reads the Post table to assemble
  // sitemap/RSS, so we keep the dependency intra-stack and avoid a
  // function → data → auth → function cycle.
  resourceGroupName: 'data',
  // Higher than dispatcher because plugins (sitemap/RSS) load all
  // published posts and serialize XML.
  memoryMB: 512,
  timeoutSeconds: 60,
})
