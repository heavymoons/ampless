---
"create-ampless": patch
---

Auto-recover sites already corrupted by the buggy `create-ampless@alpha`
published before [PR #172](https://github.com/heavymoons/ampless/pull/172).

PR #172 already stops `update-ampless` from copying
`templates/plugin-local/` and `templates/plugin-standalone/` into the
user's `themes/` going forward, but every site that ran the buggy
alpha still has the bogus `themes/plugin-local/` and
`themes/plugin-standalone/` directories on disk, plus a regenerated
`themes-registry.ts` that imports them — `next build` crashes with
module-not-found because the templates ship with `{{ }}` placeholders
in their `index.ts`.

This patch makes `syncThemes` walk the user's `themes/` and delete any
directory whose name matches a known non-theme template prefix
(`plugin-`). The deletions are reported through the new
`UpgradeResult.themesQuarantined` field and surfaced in the CLI as a
`recover: N bogus theme dir(s) removed` log line. Re-running
`npx create-ampless@alpha` on an affected site is now enough to heal
it — the bogus dirs disappear, the regenerated registry stops trying
to import them, and `next build` succeeds. No manual `rm -rf` needed.

Regression test in `upgrade.test.ts`
(`auto-recovers themes/plugin-* leaked in by the buggy alpha`):
pre-creates the corrupted state, runs upgrade, asserts the bogus
dirs are deleted, the user's `my-blog/` is preserved, and the
regenerated registry no longer references the bogus names.
