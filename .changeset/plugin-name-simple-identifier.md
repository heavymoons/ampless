---
"@ampless/plugin-youtube": patch
"@ampless/plugin-x-embed": patch
---

Fix the plugin namespace default for `@ampless/plugin-youtube` and
`@ampless/plugin-x-embed`. Both were using their scoped npm package
name (`@ampless/plugin-youtube`, `@ampless/plugin-x-embed`) as the
`definePlugin({ name })` default, which violates the
`/^[a-zA-Z0-9_-]+$/` namespace validator and made the runtime skip
both plugins entirely with:

> plugin namespace "@ampless/plugin-youtube" violates
> /^[a-zA-Z0-9_-]+$/. Use a simple identifier. Skipping plugin.

The defaults are now `'youtube'` and `'x-embed'` respectively, matching
the existing first-party convention (`'seo'`, `'rss'`, `'og-image'`,
etc. where the simple identifier is the part after `plugin-`). The
scoped npm name continues to live in `definePlugin({ packageName })`
(unchanged), where Phase 5 static-manifest cross-check expects it.
The `package.json#amplessPlugin.name` static manifest is bumped to
match.

Sites that already adopted alpha.1 / alpha.2 (both broken — alpha.2 was
the unrelated PR #252 publish that did not include this fix) only need
a `npm i @ampless/plugin-youtube@alpha @ampless/plugin-x-embed@alpha`
once the next alpha (≥ alpha.3, whatever this PR ships) is published —
no settings or DB migration needed (the plugins were never successfully
registered before this fix, so no state was persisted under the bogus
names).
