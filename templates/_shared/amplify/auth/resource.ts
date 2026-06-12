import { defineAuth } from '@aws-amplify/backend'
import { amplessAuthConfig } from '@ampless/backend'
import { postConfirmation } from './post-confirmation/resource.js'
import { authCustomizations } from './resource.custom.js'

// Provisions a Cognito User Pool + Identity Pool with the three role
// groups (ampless-admin, ampless-editor, ampless-reader) and wires in
// the post-confirmation Lambda that promotes the first confirmed user
// to ampless-admin.
//
// `defineAuth` must be called from this file directly — Amplify Gen 2's
// import-path verifier requires it to live at amplify/auth/resource.ts.
// `amplessAuthConfig` just returns the props object.
//
// Per-site auth knobs (e.g. passkey Relying Party ID on a custom
// domain) live in `resource.custom.ts` — that file is yours to edit and
// is never overwritten by `update-ampless`.
export const auth = defineAuth(
  amplessAuthConfig({ postConfirmation, ...authCustomizations })
)
