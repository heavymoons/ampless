---
"@ampless/admin": patch
---

Fix `/admin/plugins` failing to render plugins that only declare
`settings.secret` (no `settings.public`).

The page factory in [`packages/admin/src/pages/plugins.tsx`](packages/admin/src/pages/plugins.tsx) filtered each
configured plugin out of the listing if `p.settings?.public` was
empty or missing, and never passed `secretFields` to
`PluginSettingsForm`. The Phase 6a webhook retrofit
(`@ampless/plugin-webhook` ≥ 0.2.0-alpha.31) declares only
`settings.secret.signingSecret` — so the webhook section never
appeared on `/admin/plugins`, and dogfooders had no way to set the
HMAC signing secret from the admin UI.

Changes:

- Keep a plugin in the listing if it has valid public **or** secret
  fields. Skip only when both are empty after key-allowlist
  filtering.
- Skip the `loadPluginPublicSettings()` DDB read when a plugin has
  no public fields — there are no stored values to pre-fill, and
  the read would round-trip for nothing.
- Pass `secretFields` to `<PluginSettingsForm>`. The form already
  has full `secretFields` support — props, `hasPluginSecret()`
  loader, masked input, save/clear handlers — only the page-level
  prop was missing.
- Hide the public-fields Save button + status messages when a
  plugin has no public fields. Without this guard, secret-only
  plugins would render an empty form with a no-op Save button on
  top of the secret section, which reads as broken UI.

No schema changes, no DDB / AppSync API changes — purely an
admin-page-render fix that unblocks Phase 6a dogfood for
secret-only plugins.
