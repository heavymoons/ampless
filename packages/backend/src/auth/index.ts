import { defineAuth } from '@aws-amplify/backend'

export interface DefineAmplessAuthOpts {
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
 * Provision the ampless Cognito User Pool / Identity Pool with the
 * three role groups and the optional post-confirmation trigger.
 *
 * Public reads use AppSync's API key (not the guest Identity Pool
 * role) because `a.handler.custom` doesn't accept `allow.guest()`
 * in Amplify Gen 2 — see `data/resource.ts` and the RUNBOOK.
 */
// Return type loosened to `unknown` because Amplify's `Auth` construct
// type pulls in internal pnpm paths that `tsc --declaration` cannot
// portably emit. The caller imports the resulting `auth` resource and
// hands it to `defineAmplessBackend`, which is also `any`-typed for
// the same reason.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineAmplessAuth(opts: DefineAmplessAuthOpts = {}): any {
  return defineAuth({
    loginWith: {
      email: true,
    },
    groups: ['ampless-admin', 'ampless-editor', 'ampless-reader'],
    triggers: opts.postConfirmation
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { postConfirmation: opts.postConfirmation as any }
      : undefined,
  })
}
