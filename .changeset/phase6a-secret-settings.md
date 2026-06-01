---
"ampless": minor
"@ampless/admin": minor
"@ampless/backend": minor
---

Phase 6a — `secretSettings` capability + admin-managed secret storage.

Plugin authors can now store and rotate credentials (webhook signing
secrets, SMTP passwords, external API tokens) through the admin UI
without exposing them to the public site or browser-side code.

**`ampless`** — new `PluginSecretField` type (`Omit<PluginTextField,
'default'> | Omit<PluginTextareaField, 'default'>`; `default` is
removed at the type level to prevent credential leakage). New
`PluginSettingsManifest.secret?: readonly PluginSecretField[]`. New
`TrustedPluginRuntimeContext` interface that extends
`PluginRuntimeContext` with `secret<T = string>(key): Promise<T |
undefined>`. `'secretSettings'` promoted from reserved to active in
`PluginCapability`. `definePlugin()` now validates: `settings.secret`
+ non-trusted `trust_level` → throws; `settings.secret` without
`'secretSettings'` in capabilities → warns.

**`@ampless/admin`** — new `setPluginSecret` / `clearPluginSecret` /
`hasPluginSecret` helpers (no `getPluginSecret` — value read path
intentionally absent). New `SecretFieldInput` component (masked
`••••••••` placeholder, Replace, Clear, state machine for
unset/stored/editing/saving/clearing/error). `PluginSettingsForm`
now accepts `secretFields?: ReadonlyArray<PluginSecretField>` and
renders a visually separated "Secret settings" section with lock icon;
field existence checked via `hasPluginSecret()` at mount time.

**`@ampless/backend`** — new `PluginSecret` AppSync model in
`amplessSchemaModels()`: admin/editor groups have create/update/delete
only (no read); IAM-authenticated Lambda has read only. Secret values
never flow to the S3 `site-settings.json` mirror because the mirror
path queries KvStore exclusively. `createProcessorTrustedHandler` now
builds a `TrustedPluginRuntimeContext` per plugin with `ctx.secret()`
that reads from PluginSecret via DDB `GetItemCommand`; per-invocation
cache uses compound key `${instanceId ?? name}:${fieldKey}` to prevent
cross-plugin collisions.
