---
"create-ampless": patch
---

`update-ampless` now bumps user-installed `@ampless/*` plugin packages
to the latest `@alpha` dist-tag. Until this release, packages like
`@ampless/plugin-youtube` and `@ampless/plugin-x-embed` (= opt-in
plugins not bundled into `templates/_shared/package.json`) silently
stayed at whatever version the user originally installed because the
existing `mergePackageJson` sync iterates the template's deps, not
the project's.

For each `@ampless/*` entry in the project's `package.json#dependencies`
that's **not** in the template's deps, the tool runs
`npm view <pkg>@alpha version` and rewrites the project's version pin
to `^<resolved>`. The subsequent `npm install` step picks up the new
version. Template-managed packages (e.g. `@ampless/admin`,
`@ampless/runtime`) keep going through the existing sync path.

`npm view` failures (offline, package missing from registry, etc.) are
non-fatal: the tool warns and leaves the existing pin in place.

Sites that have alpha.4 of the embed plugins installed only need a
single `npm run update-ampless` run to get alpha.5 (the paste rule
fix from PR #258).
