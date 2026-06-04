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
  stores where plugin-owned data may live. The current write paths
  differ by area, in three distinct families:

  - **KvStore** (`pk='siteconfig'` admin settings and
    `pk='pluginstate:<plugin>:...'` runtime state/cache) is written
    by admin/editor through AppSync. Plugin hooks have no KvStore
    write helper today.
  - **PluginSecret + PluginSecretIndicator** are written by the
    `plugin-secret-handler` Lambda, which is invoked from the
    admin browser via the `setPluginSecret` / `clearPluginSecret`
    AppSync mutations. The trusted processor reads `PluginSecret`
    via `ctx.secret<T>()` but does NOT write to either secret
    table.
  - **S3 `public/plugins/{instanceId ?? name}/*`** is written by
    the trusted Lambda's hook context (`ctx.writePublicAsset(...)`)
    — this is the only data area a plugin hook writes to directly
    today.

  Everything outside these five areas (Post / Page / Media /
  PostTag tables, site-settings.json mirror, other plugin
  namespaces) is explicitly off-limits.
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
