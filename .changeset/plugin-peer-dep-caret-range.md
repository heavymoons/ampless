---
"@ampless/plugin-youtube": patch
"@ampless/plugin-x-embed": patch
---

Fix npm ERESOLVE on user sites: the `ampless` peer dependency is now
published as a caret range instead of an exact pin.

Both embed plugins declared `"ampless": "workspace:*"` in
`peerDependencies`. pnpm rewrites `workspace:*` to the **exact** version
at publish time (e.g. `1.0.0-alpha.48`), so any subsequent `ampless`
bump that doesn't also republish the plugins breaks `npm install` on
user sites:

```
npm error Could not resolve dependency:
npm error peer ampless@"1.0.0-alpha.48" from @ampless/plugin-x-embed@1.0.0-alpha.10
```

The trap is specific to peerDependencies: regular `workspace:*`
dependencies are safe because `updateInternalDependencies: "patch"`
makes changesets republish dependents whenever `ampless` bumps, but
changesets sees a `workspace:*` PEER range as never-out-of-range and
skips the dependent — leaving the published exact pin stale.

`workspace:^` publishes as `^<current>` (e.g. `^1.0.0-alpha.49`), which
keeps matching subsequent prerelease bumps of the same `1.0.0` tuple.
Plugins no longer need a republish on every core release.
