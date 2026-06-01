---
"ampless": patch
"@ampless/admin": minor
"@ampless/backend": minor
"create-ampless": patch
---

Phase 6a follow-up — 4 review fixes + AES-256-GCM secret encryption.

**`@ampless/backend`** (minor):
- High 1: `backend.ts` now grants `grantReadWriteData` on the
  `PluginSecret` table to the trusted Lambda and sets
  `AMPLESS_PLUGIN_SECRET_TABLE` env var. Previously the Lambda
  cold-started with a missing-env-var crash.
- High 2: `PluginSecret` `@auth` updated to allow admin/editor
  `read` (was create/update/delete only). Defense in depth shifts
  to AES-256-GCM encryption — the `value` column is ciphertext.
- Lambda-lifetime encryption-key cache added so the key is fetched
  at most once per container. `ctx.secret<T>(key)` now AES-256-GCM-
  decrypts the stored ciphertext and caches the plaintext for the
  invocation lifetime. Legacy plaintext fallback for sites created
  before encryption shipped (warns to rotate).
- `decryptSecret(key, b64)` exported for unit testing.
- New tests: `decryptSecret` round-trip, authTag mismatch/wrong-key
  throw, `ctx.secret` encrypted-value path, plaintext-cache test.

**`@ampless/admin`** (minor):
- High 2 (admin side): `hasPluginSecret` now gets a real `.get()`
  result because admin/editor have read authorization. Upsert in
  `setPluginSecret` works correctly.
- Low 4: `setPluginSecret` signature changed to
  `setPluginSecret(field: PluginSecretField, instanceId, value)`.
  Calls `validatePluginSettingValue(field, value, 'strict')` before
  writing — enforces `maxLength`, `pattern`, `required` server-side
  to prevent UI bypass.
- Encryption: admin browser uses Web Crypto `crypto.subtle`
  (AES-GCM) to encrypt the plaintext before calling AppSync. Per-site
  32-byte key is lazily created in the `__internal:encryption-key`
  row; race-safe re-fetch on concurrent-tab conflict.
- `plugin-settings-form.tsx` updated to pass `field` to `setPluginSecret`.
- New test file `plugin-secret.test.ts`: 21 tests covering key
  management, encryption, field validation, upsert logic, and
  race-safe key creation.

**`ampless`** (patch):
- Docs: `docs/architecture/08-plugin-architecture.{md,ja.md}` and
  `packages/ampless/docs/plugin-author-guide.{md,ja.md}` updated to
  reflect encryption design (defense-in-depth shift, ciphertext
  storage, Lambda-lifetime key cache, plaintext invocation cache).

**`create-ampless`** (patch):
- Retroactive fix for PR #196 omission: `templates/_shared/docs/
  plugin-author-guide.{md,ja.md}` (shipped in the create-ampless
  tarball) now describes AES-256-GCM encryption in the secret
  settings section.
