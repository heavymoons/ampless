// Re-exported from @ampless/backend so the package can ship Lambda
// handler updates via `npm update`. Amplify's esbuild follows this
// import and bundles the real handler into the Lambda artifact.
//
// The handler validates Cognito group membership (admin/editor),
// enforces a hard 10,000-char server cap on the value (field-level
// `pattern` / `maxLength` come from the admin client and are NOT
// re-enforced here), encrypts with the AES-256-GCM key from
// `process.env.PLUGIN_SECRET_ENCRYPTION_KEY`, and dual-writes to
// PluginSecret + PluginSecretIndicator.
export { handler } from '@ampless/backend/functions/plugin-secret-handler'
