---
"@ampless/backend": minor
"@ampless/admin": minor
"create-ampless": minor
---

Add passkey (WebAuthn) sign-in for the admin, enabled by default.

After a one-time password login, operators register a passkey from the
new **Account** page and sign in with Face ID / Touch ID / a security
key. The password flow stays available as the bootstrap step and
fallback. Passkeys are provisioned entirely within the Amplify Gen 2
stack — no AWS console steps and no SES setup.

- **`@ampless/backend`**: `amplessAuthConfig` gains a `webAuthn?:
  AmplessWebAuthnOption | false` option (default `true` = passkeys on,
  RP ID auto-resolved). Pass `{ relyingPartyId: 'admin.example.com' }`
  to pin the Relying Party ID for a custom domain, or `false` for
  password-only. New `AmplessWebAuthnOption` type export. Peer
  `@aws-amplify/backend` bumped to `^1.19.0` (first version with
  `loginWith.webAuthn`).
- **`@ampless/admin`**: passkey button on the login screen (with
  last-email recall), a new account page (`createAccountPage`) to
  register / list / delete passkeys, and a sidebar link to it. Peer
  `aws-amplify` bumped to `^6.17.0` (client WebAuthn APIs).
- **`create-ampless`**: the template seeds `amplify/auth/resource.custom.ts`
  (the per-site passkey knob) and `update-ampless` now keeps the Amplify
  SDK + backend toolchain (`aws-amplify`, `@aws-amplify/adapter-nextjs`,
  `@aws-amplify/backend`, `@aws-amplify/backend-cli`) in lockstep with
  the template so existing sites can synth + sign in with passkeys.

See [docs/passkeys.md](https://github.com/heavymoons/ampless/blob/main/docs/passkeys.md).
