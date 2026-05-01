import { defineAuth } from '@aws-amplify/backend'
import { postConfirmation } from './post-confirmation/resource.js'

// `defineAuth` provisions a Cognito User Pool plus an Identity Pool. The
// Identity Pool's unauthenticated (guest) role is what backs `allow.guest()`
// on the data layer's custom queries (listPublishedPosts, getPublishedPost,
// listPostsByTag) — that's how the public site reads posts without a
// rotating AppSync API key. See amplify/data/resource.ts for the auth wiring.
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: ['ampless-admin', 'ampless-editor', 'ampless-reader'],
  triggers: {
    postConfirmation,
  },
})
