---
"ampless": minor
"@ampless/backend": minor
"@ampless/plugin-seo": patch
"@ampless/plugin-rss": patch
"create-ampless": patch
---

Phase 3c plugin extension: formalise the `writePublicAsset` capability.
Runtime context now namespaces trusted plugin assets under
`public/plugins/<instanceId ?? name>/`, validates keys against path traversal,
absolute paths, backslashes, control characters, and length limits, and warns
once when a plugin declares capabilities but calls `writePublicAsset` without
declaring that capability. Existing plugins without a `capabilities` field keep
working without warnings. Migrates `@ampless/plugin-seo` and
`@ampless/plugin-rss` to declare the new capability set, and updates the
scaffolded plugin author guide.
