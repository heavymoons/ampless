import { defineStorage } from '@aws-amplify/backend'

/**
 * Provision the ampless S3 bucket with the standard access map:
 *   - `public/media/*`   — guest read, admin/editor full
 *   - `public/plugins/*` — guest read, admin full
 *
 * Bucket-level overrides (PublicAccessBlock, CORS, IAM policies for
 * `public/site-settings/*`) are applied by `defineAmplessBackend`
 * after `defineBackend` runs.
 *
 * Return type is `unknown` because Amplify's storage construct type
 * carries internal pnpm paths that don't survive declaration emit —
 * the resulting `storage` resource flows into `defineAmplessBackend`
 * unchanged.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineAmplessStorage(): any {
  return defineStorage({
    name: 'amplessMedia',
    access: (allow) => ({
      'public/media/*': [
        allow.guest.to(['read']),
        allow.groups(['ampless-admin', 'ampless-editor']).to(['read', 'write', 'delete']),
      ],
      'public/plugins/*': [
        allow.guest.to(['read']),
        allow.groups(['ampless-admin']).to(['read', 'write', 'delete']),
      ],
    }),
  })
}
