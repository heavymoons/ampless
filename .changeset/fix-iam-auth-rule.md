---
"@ampless/backend": patch
---

Fix CDK synth failure on `PluginSecret` + `PluginSecretIndicator` models.

The Phase 6a v2.2 code used `allow.authenticated('iam')` as the auth
rule, but `'iam'` is not a valid provider for `allow.authenticated()`
in Amplify Gen 2 data. CDK synth threw `Invalid provider (iam)
given!` at deploy time — unit tests passed because the failure is in
the CDK construct synthesis layer, not the TypeScript layer.

Replace with `allow.resource(opts.pluginSecretHandlerFunction)` —
the correct way to grant a specific Lambda AppSync access to a
model. This is the same pattern already in use for
`opts.mcpHandlerFunction` at the schema level.

For partially-wired deployments where
`opts.pluginSecretHandlerFunction` is not provided (e.g. older
projects mid-upgrade), fall back to an admin-only group rule on
`PluginSecret` so CDK synth still succeeds — the feature won't
actually work without the handler, but the deployment doesn't fail.

`PluginSecretIndicator` gains an explicit comment that the
admin/editor groups need direct write+delete in addition to read,
so a clear retry after a partial dual-write failure can resolve the
inconsistency.

Trusted-processor's direct DDB SDK access is unaffected — that path
goes through `grantReadData` in `backend.ts`, not through AppSync.
