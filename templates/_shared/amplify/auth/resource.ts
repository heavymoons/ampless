import { defineAuth } from '@aws-amplify/backend'
import { amplessAuthConfig, resolveWebAuthn } from '@ampless/backend'
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
// The WebAuthn Relying Party ID is auto-derived from `cms.config.ts`
// `site.url` in Amplify Hosting pipeline builds. In sandbox (`ampx
// sandbox`) the RP ID stays `localhost` (Amplify auto-resolves it).
// Override with `webAuthn: { relyingPartyId }` in resource.custom.ts
// only when the admin is served from a different subdomain than site.url.
import cmsConfig from '../../cms.config'

const { webAuthn: webAuthnOverride, ...otherAuthCustomizations } = authCustomizations

export const auth = defineAuth(
  amplessAuthConfig({
    postConfirmation,
    ...otherAuthCustomizations,
    webAuthn: resolveWebAuthn({
      override: webAuthnOverride,
      siteUrl: cmsConfig.site.url,
      isPipeline: Boolean(process.env.AWS_BRANCH),
    }),
  })
)
