---
"ampless": minor
"@ampless/runtime": minor
"@ampless/plugin-analytics-ga4": patch
"@ampless/plugin-gtm": patch
"@ampless/plugin-plausible": patch
"@ampless/plugin-schema-jsonld": patch
"@ampless/plugin-seo": patch
"@ampless/plugin-rss": patch
"@ampless/plugin-og-image": patch
"@ampless/plugin-webhook": patch
---

Phase 5 plugin extension (foundation): static manifest convention.

Adds `PluginPackageManifest` type for the optional
`package.json#amplessPlugin` field — lets the runtime identify a
plugin and its surface area without executing its JS. `AmplessPlugin`
gains an optional `packageName` field so plugins can opt in to
install-time validation.

The runtime cross-checks the static manifest against the factory
return value at `createPluginHead` constructor time using a sync
`loadPackageManifest` helper (kept sync to preserve the existing sync
`createPluginHead` / `createAmpless` constructor chain). `apiVersion`
mismatch — or a value above the supported `SUPPORTED_API_VERSION` —
throws (breaking-change protection); `name` / `trustLevel` /
`capabilities` mismatch warns in dev mode. Plugins without a
`packageName`, or with a manifest that fails to load (subpath not
exported, parse error, field absent), skip the check entirely and
fall back to the existing per-factory mismatch warnings — backward
compatible.

All 8 first-party plugins gain:
- `package.json#amplessPlugin` static manifest mirroring the factory
- `"./package.json": "./package.json"` in `exports` (required so
  `import.meta.resolve('<pkg>/package.json')` can locate the manifest)
- `"ampless-plugin"` keyword for npm discovery
- `packageName` set in the factory return value

`@ampless/plugin-og-image` and `@ampless/plugin-webhook` additionally
gain an explicit `capabilities` array in their factory — these were
omitted historically and Phase 5's cross-check made the gap visible.
`@ampless/plugin-og-image` is `['metadata']`,
`@ampless/plugin-webhook` is `['eventHooks']`.
