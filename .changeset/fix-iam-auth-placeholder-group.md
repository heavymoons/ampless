---
"@ampless/backend": patch
---

Second-pass fix for `PluginSecret` model authorization.

The previous patch (`fix-iam-auth-rule`, alpha.48) added
`allow.resource(opts.pluginSecretHandlerFunction)` at the model
level. That throws `TypeError: allow.resource is not a function` at
CDK synth because `@aws-amplify/data-schema` strips `resource` off
the `allow` arg in model-level authorization callbacks —
`allow.resource()` only works on the schema-level `.authorization`
block (and we already use it there for `mcpHandlerFunction`).

It also wrong-fixed the security model: the fallback path when
`pluginSecretHandlerFunction` was absent fell back to
`allow.groups(['ampless-admin'])` on `PluginSecret`, which would
give admin Cognito users direct AppSync read access to the
ciphertext column. That contradicts the Phase 6a security contract.

Correct split:

- `PluginSecret` (ciphertext only) — placeholder group sentinel
  `['__ampless_internal__']`. No Cognito user belongs to that group,
  so AppSync is structurally unreachable for admin/editor. The
  plugin-secret-handler Lambda reaches the table via
  `grantReadWriteData` on the underlying DynamoDB construct in
  `backend.ts`, and the trusted-processor Lambda reaches it via
  `grantReadData` — both bypassing AppSync entirely.

- `PluginSecretIndicator` (presence-only boolean) — keeps
  `allow.groups(['ampless-admin', 'ampless-editor'])`. Admin/editor
  legitimately need AppSync R/W here for the `hasSecret` UI lookup
  and to heal partial dual-write failures from the admin side.

Regression guard added in `packages/backend/src/data/index.test.ts`
asserts `allow.resource(...)` is never called at the model level,
covering both branches of `opts.pluginSecretHandlerFunction` (the
existing guard only covered the no-opts path, which is how the
first-pass fix slipped through).
