import type { defineAuth } from '@aws-amplify/backend'

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
    },
    groups: ['ampless-admin', 'ampless-editor', 'ampless-reader'],
    triggers: opts.postConfirmation
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { postConfirmation: opts.postConfirmation as any }
      : undefined,
  }
}
