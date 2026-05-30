---
"create-ampless": patch
---

Fix `update-ampless` treating PR #168's plugin scaffold templates as
themes, and auto-recover sites already corrupted by the buggy alpha.

PR #168 added `templates/plugin-local/` and `templates/plugin-standalone/`
to `create-ampless` so `npx create-ampless plugin <name>` could scaffold
plugins, but the upgrade tool's theme discovery (`listShippedThemes`)
read every directory under `templates/` except `_shared/` as a theme.
After alpha publish, every site running `update-ampless` got the two
scaffold directories sync'd into `themes/plugin-local/` and
`themes/plugin-standalone/`, the regenerated `themes-registry.ts`
imported them as theme modules, and `next build` died with
module-not-found errors (the templates ship with `{{ }}` placeholders
in their `index.ts`).

**Forward fix**: adds a `NON_THEME_TEMPLATE_PREFIXES` allowlist
(`plugin-`) to the discovery filter. Anything under `templates/` whose
name starts with a listed prefix is now excluded from theme sync — the
scaffold templates stay reachable via the `pluginTemplateDir(mode)`
helper that the `plugin <name>` subcommand uses, but they no longer
leak into user projects.

**Auto-recovery for sites already affected**: `syncThemes` now walks
the user's `themes/` and deletes any directory whose name matches a
non-theme template prefix. The deletions are reported through the new
`UpgradeResult.themesQuarantined` field and surfaced in the CLI as a
`recover: N bogus theme dir(s) removed` log line. Re-running
`npx create-ampless@alpha` on an affected site is now enough to heal
it — the bogus dirs disappear and the regenerated registry stops
trying to import them. No manual `rm -rf` needed.

Regression tests in `upgrade.test.ts`:
- `does not treat plugin-* scaffold templates as themes` covers the
  forward path (clean install never sees the leak).
- `auto-recovers themes/plugin-* leaked in by the buggy alpha`
  pre-creates the corrupted state and asserts the dirs are deleted,
  the user's `my-blog/` is preserved, and the regenerated registry no
  longer references `plugin-local` / `plugin-standalone`.
