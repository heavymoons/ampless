import { defineAmplessAuth } from '@ampless/backend'
import { postConfirmation } from './post-confirmation/resource.js'

// Provisions a Cognito User Pool + Identity Pool with the three role
// groups (ampless-admin, ampless-editor, ampless-reader) and wires in
// the post-confirmation Lambda that promotes the first confirmed user
// to ampless-admin.
export const auth = defineAmplessAuth({ postConfirmation })
