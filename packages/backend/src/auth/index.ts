import type { defineAuth } from '@aws-amplify/backend'

/**
 * WebAuthn (passkey) login knob. `true` lets Amplify auto-resolve the
 * Relying Party ID from the deployment domain (works on Amplify Hosting
 * domains and `localhost` sandboxes); the object form pins the RP ID
 * explicitly, which is required when the admin is served from a custom
 * domain behind a CDN (the auto-resolved RP ID would be the Amplify
 * Hosting domain and the browser raises `SecurityError`).
 *
 * Changing the RP ID after passkeys exist invalidates every registered
 * credential — operators have to re-register. The password flow always
 * stays available as the fallback.
 *
 * Derived from `defineAuth`'s `loginWith.webAuthn` so it tracks the
 * underlying Amplify type. The non-`undefined` branch is the shape we
 * accept (`true | { relyingPartyId; userVerification? }`).
 */
export type AmplessWebAuthnOption = NonNullable<
  NonNullable<Parameters<typeof defineAuth>[0]['loginWith']>['webAuthn']
>

export interface AmplessAuthConfigOpts {
  /**
   * The `post-confirmation` Cognito Lambda trigger that promotes the
   * first signup to `ampless-admin`. Wire your own `defineFunction`
   * pointing at the thin-shell handler that re-exports from
   * `@ampless/backend/auth/post-confirmation`.
   *
   * Typed as `unknown` because Amplify's `defineFunction` return type
   * carries internal pnpm paths that don't survive declaration emit —
   * caller-side `defineFunction({ entry: './handler.ts' })` flows
   * through without losing functionality.
   */
  postConfirmation?: unknown

  /**
   * Passkey (WebAuthn) login. Defaults to `true` (auto RP ID) so new
   * sites get passkeys out of the box. Pass the object form to pin the
   * Relying Party ID on a custom domain, or `false` to opt out entirely
   * (the `webAuthn` key is then omitted from the Cognito config).
   */
  webAuthn?: AmplessWebAuthnOption | false
}

export interface ResolveWebAuthnOpts {
  /** Explicit override from resource.custom.ts. When present, takes precedence. */
  override?: AmplessWebAuthnOption | false
  /** `site.url` from cms.config — used to derive hostname in pipeline builds. */
  siteUrl: string
  /** True only in Amplify Hosting pipeline builds (`Boolean(process.env.AWS_BRANCH)`). */
  isPipeline: boolean
}

/**
 * Single source of truth for the WebAuthn relying-party configuration.
 *
 * Priority:
 *   1. `override !== undefined` → return it verbatim (supports `false` to disable).
 *   2. Not a pipeline build (sandbox / local) → return `true` so Amplify
 *      auto-resolves the RP ID from `localhost` (no RP ID needed in dev).
 *   3. Pipeline build → derive `{ relyingPartyId }` from `siteUrl`.
 *      Falls back to `true` if `siteUrl` is not a valid URL (logs a warning).
 */
export function resolveWebAuthn(opts: ResolveWebAuthnOpts): AmplessWebAuthnOption | false {
  if (opts.override !== undefined) return opts.override
  if (!opts.isPipeline) return true
  try {
    const hostname = new URL(opts.siteUrl).hostname
    return { relyingPartyId: hostname }
  } catch {
    console.warn(
      '[ampless] invalid site.url for WebAuthn relying party, falling back to auto:',
      opts.siteUrl
    )
    return true
  }
}

/**
 * Build the ampless Cognito configuration (User Pool + Identity Pool
 * with the three role groups and the optional post-confirmation
 * trigger) as a plain options object suitable for `defineAuth(...)`.
 *
 * Returning a config object — rather than calling `defineAuth`
 * internally — keeps the actual `defineAuth` call inside the user's
 * `amplify/auth/resource.ts`. Amplify Gen 2's import-path verifier
 * (`@aws-amplify/backend-auth/lib/factory.js`) inspects the second
 * stack frame and requires the call site to live at
 * `amplify/auth/resource.ts`; routing through this package fails
 * that check.
 *
 * Public reads use AppSync's API key (not the guest Identity Pool
 * role) because `a.handler.custom` doesn't accept `allow.guest()`
 * in Amplify Gen 2 — see `data/resource.ts` and the RUNBOOK.
 *
 * Usage:
 *
 *     // amplify/auth/resource.ts
 *     import { defineAuth } from '@aws-amplify/backend'
 *     import { amplessAuthConfig } from '@ampless/backend'
 *     import { postConfirmation } from './post-confirmation/resource.js'
 *     export const auth = defineAuth(amplessAuthConfig({ postConfirmation }))
 */
export function amplessAuthConfig(
  opts: AmplessAuthConfigOpts = {}
): Parameters<typeof defineAuth>[0] {
  return {
    loginWith: {
      email: true,
      // Passkeys are on by default; `webAuthn: false` drops the key so
      // Cognito provisions a password-only sign-in policy.
      ...(opts.webAuthn === false ? {} : { webAuthn: opts.webAuthn ?? true }),
    },
    groups: ['ampless-admin', 'ampless-editor', 'ampless-reader'],
    triggers: opts.postConfirmation
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { postConfirmation: opts.postConfirmation as any }
      : undefined,
  }
}
