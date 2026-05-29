---
"create-ampless": patch
---

Fix `update-ampless` not seeding `plugins/README` into projects that
predate the directory.

PR #162 added `plugins/` to `PROTECTED_PATTERNS` so user-added plugin
files survive upgrades, but the protection skipped seeding the
introductory README on the upgrade path. New scaffolds got it (the
init flow copies all of `_shared/`), existing projects didn't — there
was no way to discover the local-plugin convention after the fact.

Carves `plugins/README.md` and `plugins/README.ja.md` out of
`isProtected` via `SEED_IF_MISSING_PATTERN`, mirroring how
`*.custom.ts` extension stubs are handled: copied in on first
encounter, left alone forever after. The `plugins/` directory itself
and everything else inside it stays user-owned and is never touched
by upgrades.
