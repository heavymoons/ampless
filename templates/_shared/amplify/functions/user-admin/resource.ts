import { defineFunction } from '@aws-amplify/backend'

export const userAdmin = defineFunction({
  name: 'user-admin',
  entry: './handler.ts',
})
