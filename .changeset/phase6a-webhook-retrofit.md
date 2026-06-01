---
"@ampless/plugin-webhook": minor
---

Phase 6a — retrofit webhook plugin with `secretSettings` capability and trusted Lambda.

`trust_level` changed from `'untrusted'` to `'trusted'` so the plugin can access the
admin-managed signing secret via `ctx.secret('signingSecret')`.

New `settings.secret` block declares the `signingSecret` field (type: `'text'`,
maxLength: 256). The `default` property is intentionally absent — per the
`PluginSecretField` type constraint, defaults are forbidden to prevent credential
leakage into the manifest or public bundles.

Secret priority in each dispatch: admin-managed secret (if saved) overrides all
per-endpoint constructor `secret` values, enabling zero-deploy key rotation from
`/admin/plugins/webhook → Secret settings`. When no admin secret is saved, each
endpoint falls back to its own constructor-time `secret` (closure-private, never
exposed in the manifest).

`capabilities` updated to `['eventHooks', 'secretSettings']`. `package.json#amplessPlugin`
static manifest updated to match (`trustLevel: 'trusted'`, both capabilities listed).
README (en + ja) gains a new "Signing secret (admin-managed)" section covering the
admin UI workflow, secret precedence, and rotation procedure.
