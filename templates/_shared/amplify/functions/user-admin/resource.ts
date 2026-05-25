import { defineFunction } from '@aws-amplify/backend'

// `resourceGroupName: 'data'` co-locates this Lambda with the AppSync
// stack. Required because ampless wires userAdmin as a custom GraphQL
// resolver (data → function) while api-key-renewer reads graphqlApi
// (function → data); leaving userAdmin in the default `function` stack
// turns those two arrows into a CloudFormation circular dependency.
export const userAdmin = defineFunction({
  name: 'user-admin',
  entry: './handler.ts',
  runtime: 22,
  resourceGroupName: 'data',
})
