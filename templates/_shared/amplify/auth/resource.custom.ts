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
// Passkeys are ENABLED BY DEFAULT. `amplify/auth/resource.ts` auto-
// derives the WebAuthn Relying Party ID from `cms.config.ts` `site.url`
// in Amplify Hosting pipeline builds, and uses `localhost` (auto-
// resolved by Amplify) in `ampx sandbox`. This file is usually unneeded
// for passkeys.
//
// Set `webAuthn: { relyingPartyId: 'admin.example.com' }` ONLY when the
// admin is served from a different subdomain than `site.url` (e.g. site
// is at `example.com` but the admin CDN origin is `admin.example.com`).
//
//   export const authCustomizations: Pick<AmplessAuthConfigOpts, 'webAuthn'> = {
//     webAuthn: { relyingPartyId: 'admin.example.com' },
//   }
//
// To turn passkeys off entirely (password-only sign-in AND removes the
// passkey UI from the admin completely):
//
//   export const authCustomizations: Pick<AmplessAuthConfigOpts, 'webAuthn'> = {
//     webAuthn: false,
//   }
//
// ⚠️ Changing the RP ID after operators have registered passkeys
// invalidates every existing credential — they'll have to register
// again from the account page. The password flow always stays available
// as the fallback. See `https://github.com/heavymoons/ampless/wiki/passkeys`.
//
// ⚠️ cms.config.ts must not import theme CSS or browser-only modules —
// it is loaded at CDK synth time when deriving the RP ID.

import type { AmplessAuthConfigOpts } from '@ampless/backend'

export const authCustomizations: Pick<AmplessAuthConfigOpts, 'webAuthn'> = {}
