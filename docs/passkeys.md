# Passkey sign-in (WebAuthn)

> 日本語版: [passkeys.ja.md](./passkeys.ja.md)

ampless supports **passkey** sign-in for the admin: after a one-time password login, operators register a passkey and from then on sign in with Face ID / Touch ID / Windows Hello / a hardware security key — no password to type or remember. Passkeys are **enabled by default** on new sites; the password flow always stays available as the bootstrap step and the fallback.

Passkeys are provisioned entirely within the Amplify Gen 2 (CDK / CloudFormation) stack — no AWS console clicks and no SES setup. They use Cognito's built-in WebAuthn support (the Essentials tier, which is the default).

## For operators (non-engineers)

1. **First sign-in uses your password.** Visit `/login` and sign in (or sign up — the first user becomes the site admin).
2. **Open the Account page.** Click your email address at the bottom of the sidebar.
3. **Add a passkey.** Click **Add passkey** and follow your device's prompt (Face ID / Touch ID / security key). The passkey is bound to this site and this device/browser (or your platform's synced keychain).
4. **Sign in with the passkey next time.** On the login screen, your email is pre-filled — click **Sign in with passkey** and approve the prompt. You're in.

You can register more than one passkey (e.g. one per device) and delete any of them from the Account page. Deleting your last passkey just means you fall back to the password — you're never locked out.

If the login screen shows *"No passkey is registered for this account yet"*, sign in with your password and add one from the Account page first.

## For engineers (site builders)

The default works out of the box on:

- **Amplify Hosting domains** (`*.amplifyapp.com`)
- **`localhost` sandboxes** (`npm run sandbox` + `localhost:3000`)

In both cases Amplify auto-resolves the WebAuthn **Relying Party (RP) ID** from the domain the browser is on.

### Custom domains behind a CDN

If you serve the admin from a **custom domain fronted by your own CDN** (see [cdn-fronting-tips.md](./cdn-fronting-tips.md)), the auto-resolved RP ID won't match the URL the browser sees, and passkey sign-in fails with a `SecurityError`. The admin surfaces this as *"This site isn't configured for passkeys on this domain"*.

Pin the RP ID to the **bare domain** operators visit (no protocol, no path) in `amplify/auth/resource.custom.ts`:

```ts
import type { AmplessAuthConfigOpts } from '@ampless/backend'

export const authCustomizations: Pick<AmplessAuthConfigOpts, 'webAuthn'> = {
  webAuthn: { relyingPartyId: 'admin.example.com' },
}
```

The RP ID must be the registrable domain (or a parent of it) that serves the admin — e.g. `example.com` or `admin.example.com`, never `https://admin.example.com/` or a path. Redeploy after editing.

### Disabling passkeys

To run password-only:

```ts
export const authCustomizations: Pick<AmplessAuthConfigOpts, 'webAuthn'> = {
  webAuthn: false,
}
```

This drops the `webAuthn` key from the Cognito config so the User Pool gets a password-only sign-in policy.

### ⚠️ Changing the RP ID invalidates existing passkeys

A WebAuthn credential is bound to the RP ID it was registered under. **Changing `relyingPartyId` after operators have registered passkeys invalidates every existing credential** — they'll have to register again from the Account page. Pick the right domain before rolling passkeys out to your team. The password flow keeps working throughout, so no one is locked out.

## How it's wired

- **Backend** — `amplessAuthConfig({ webAuthn })` (`@ampless/backend`) sets `loginWith.webAuthn`. The template threads the knob through `amplify/auth/resource.custom.ts` (a per-site file `update-ampless` never overwrites). See the [`@ampless/backend` README](../packages/backend/README.md).
- **Sign-in** — the login screen runs `signIn({ options: { authFlowType: 'USER_AUTH', preferredChallenge: 'WEB_AUTHN' } })`; Amplify performs the browser WebAuthn ceremony.
- **Registration / listing / deletion** — the Account page uses `associateWebAuthnCredential` / `listWebAuthnCredentials` / `deleteWebAuthnCredential`. Registration requires a signed-in session, which is why the password login can't be removed.

## Requirements

- `@ampless/backend` peer `@aws-amplify/backend` >= `1.19.0` (passkey support shipped there)
- `@ampless/admin` peer `aws-amplify` >= `6.17.0` (client WebAuthn APIs)
- A browser + platform that supports WebAuthn platform authenticators (all current major browsers do)

`update-ampless` keeps these in lockstep with the template, so existing sites pick up the right versions on upgrade.
