// Custom Cognito auth options for this project.
//
// `amplify/auth/resource.ts` spreads this object into
// `amplessAuthConfig({ postConfirmation, ...authCustomizations })`, so
// anything you set here overrides the ampless defaults.
//
// This file is NEVER overwritten by `create-ampless upgrade` —
// `amplify/auth/resource.ts` is, so keep your auth customizations here.
//
// ── Passkeys (WebAuthn) ──────────────────────────────────────────────
//
// Passkeys are ENABLED BY DEFAULT (the empty object below). With the
// default, Amplify auto-resolves the WebAuthn Relying Party ID from the
// deployment domain, which works on Amplify Hosting domains and on a
// `localhost` sandbox.
//
// If you serve the admin from a CUSTOM DOMAIN behind a CDN, the
// auto-resolved RP ID won't match the URL the browser sees and passkey
// sign-in fails with a `SecurityError`. Pin the RP ID to the bare
// domain (no protocol, no path) the operators visit:
//
//   export const authCustomizations: Pick<AmplessAuthConfigOpts, 'webAuthn'> = {
//     webAuthn: { relyingPartyId: 'admin.example.com' },
//   }
//
// To turn passkeys off entirely (password-only sign-in):
//
//   export const authCustomizations: Pick<AmplessAuthConfigOpts, 'webAuthn'> = {
//     webAuthn: false,
//   }
//
// ⚠️ Changing the RP ID after operators have registered passkeys
// invalidates every existing credential — they'll have to register
// again from the account page. The password flow always stays available
// as the fallback. See `docs/passkeys.md`.

import type { AmplessAuthConfigOpts } from '@ampless/backend'

export const authCustomizations: Pick<AmplessAuthConfigOpts, 'webAuthn'> = {}
