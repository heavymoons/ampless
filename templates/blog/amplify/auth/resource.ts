import { defineAuth } from '@aws-amplify/backend'
import { postConfirmation } from './post-confirmation/resource.js'

export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: ['ampless-admin', 'ampless-editor', 'ampless-reader'],
  triggers: {
    postConfirmation,
  },
})
