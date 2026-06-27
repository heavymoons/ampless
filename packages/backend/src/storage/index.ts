import type { defineStorage } from '@aws-amplify/backend'

/**
 * Build the ampless S3 bucket configuration as a plain options object
 * suitable for `defineStorage(...)`. Access map:
 *   - `public/media/*`   — guest read, admin/editor full
 *   - `public/static/*`  — guest read, admin/editor full (static-bundle posts)
 *   - `public/plugins/*` — guest read, admin full
 *
 * Bucket-level overrides (PublicAccessBlock, CORS, IAM policies for
 * `public/site-settings/*`) are applied by `defineAmplessBackend`
 * after `defineBackend` runs.
 *
 * Returning a config object — rather than calling `defineStorage`
 * internally — keeps the actual `defineStorage` call inside the
 * user's `amplify/storage/resource.ts`. Amplify Gen 2's import-path
 * verifier (`@aws-amplify/backend-storage/lib/factory.js`) inspects
 * the second stack frame and requires the call site to live at
 * `amplify/storage/resource.ts`; routing through this package fails
 * that check.
 *
 * Usage:
 *
 *     // amplify/storage/resource.ts
 *     import { defineStorage } from '@aws-amplify/backend'
 *     import { amplessStorageConfig } from '@ampless/backend'
 *     export const storage = defineStorage(amplessStorageConfig())
 */
export function amplessStorageConfig(): Parameters<typeof defineStorage>[0] {
  return {
    name: 'amplessMedia',
    access: (allow) => ({
      'public/media/*': [
        allow.guest.to(['read']),
        allow.groups(['ampless-admin', 'ampless-editor']).to(['read', 'write', 'delete']),
      ],
      // Static-bundle posts (`format: 'static'`) upload their files to
      // `public/static/<slug>/...` from the browser admin via Cognito
      // identity-pool credentials. Without this rule the admin group's
      // role is denied `s3:PutObject` and saving the post fails. Mirrors
      // the media grant; the MCP/Lambda upload path is granted separately
      // on the function role in `defineAmplessBackend`.
      'public/static/*': [
        allow.guest.to(['read']),
        allow.groups(['ampless-admin', 'ampless-editor']).to(['read', 'write', 'delete']),
      ],
      'public/plugins/*': [
        allow.guest.to(['read']),
        allow.groups(['ampless-admin']).to(['read', 'write', 'delete']),
      ],
    }),
  }
}
