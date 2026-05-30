---
"create-ampless": patch
---

Fix `update-ampless` treating PR #168's plugin scaffold templates as themes.

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

Adds a `NON_THEME_TEMPLATE_PREFIXES` allowlist (`plugin-`) to the
discovery filter. Anything under `templates/` whose name starts with
a listed prefix is now excluded from theme sync — the scaffold
templates stay reachable via the `pluginTemplateDir(mode)` helper
that the `plugin <name>` subcommand uses, but they no longer leak into
user projects.

**Recovery for sites already affected**: delete the bogus directories
and edit the registry by hand (or rerun upgrade after this patch
publishes):

```bash
rm -rf themes/plugin-local themes/plugin-standalone
# Remove the matching imports + entries from themes-registry.ts
```

Regression test in `upgrade.test.ts` (`does not treat plugin-*
scaffold templates as themes`) sets up a `templatesRoot` containing
both a real theme and the two scaffold templates, then asserts only
the real theme reaches the project's `themes/` directory and the
`themesSynced` result.
