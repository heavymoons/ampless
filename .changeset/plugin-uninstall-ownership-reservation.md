---
"ampless": minor
"create-ampless": patch
---

Reserve `uninstall?: (ctx: PluginUninstallContext) => Promise<void>`
hook on `AmplessPlugin` and consolidate the plugin-owned data
areas documentation (Phase 1 no-op).

Type changes:
- New `PluginUninstallContext` interface, currently a structural
  extension of `PluginRuntimeContext`. The dedicated type exists so
  future cleanup helpers (`deletePublicAsset` /
  `deletePluginSetting` / `deletePluginSecret`) can be added to the
  uninstall surface without leaking into the regular event-hook
  context. **Phase 1 scope: the type is reserved but does NOT yet
  carry cleanup helpers** — those land in the lifecycle-dispatch PR.
- `AmplessPlugin.uninstall?` added as a future lifecycle hook.
  Runtime does not invoke it yet, and the ctx does not yet have
  cleanup methods, so declaring `uninstall` today means an empty
  body (`async (_ctx) => {}`). When the lifecycle-dispatch PR
  ships, plugins that declared the empty stub will receive
  invocation events; the cleanup body itself needs to be added
  then (additive on `PluginUninstallContext`). This is a
  name-and-shape reservation, not a "write your cleanup code
  today" promise.

Documentation:
- `docs/architecture/08-plugin-architecture.md` (en + ja): the
  existing "Plugin State Storage" table is corrected (PluginSecret
  identifier is sk-only after the `siteId` removal; the old row
  still showed `siteId + sk`). A new "Plugin-owned data areas"
  section is added immediately after it, listing the **five**
  stores plugins are allowed to write to: KvStore
  `pk='siteconfig', sk='plugins.<instanceId>.<fieldKey>'`, KvStore
  `pk='pluginstate:<plugin>:...'`, PluginSecret +
  PluginSecretIndicator `sk='plugins.<instanceId>.<fieldKey>'`,
  and S3 `public/plugins/{instanceId ?? name}/*`. Everything else
  (Post / Page / Media / PostTag tables, site-settings.json
  mirror, other plugin namespaces) is explicitly off-limits.
- Author guide en/ja in both source-of-truth and template
  locations updated to mirror the architecture doc, with a code
  example for the uninstall reservation pattern.

No runtime behaviour change. The five data areas continue to leak
as orphan data when a plugin is removed from `cms.config.ts` — that
cleanup mechanism needs a separate lifecycle-dispatch PR. This
patch reserves the API surface (hook name + signature + dedicated
context type) so the future PR can wire cleanup invocation
additively without renaming/reshaping the hook itself. A re-publish
is still required for any plugin that wants to add an actual
cleanup body — the reservation removes the signature-migration
cost, not the body-implementation cost.
