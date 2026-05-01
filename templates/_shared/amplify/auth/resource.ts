import { defineAuth } from '@aws-amplify/backend'
import { postConfirmation } from './post-confirmation/resource.js'

// `defineAuth` provisions a Cognito User Pool plus an Identity Pool.
// Public reads from the blog use an AppSync API key, not the Identity
// Pool guest role, because Amplify Gen 2 `a.handler.custom` resolvers
// don't accept `allow.guest()` (only apiKey / userPool / lambda /
// group / owner). See amplify/data/resource.ts and RUNBOOK.md.
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: ['ampless-admin', 'ampless-editor', 'ampless-reader'],
  triggers: {
    postConfirmation,
  },
})
