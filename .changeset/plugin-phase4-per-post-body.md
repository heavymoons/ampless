---
"ampless": minor
"@ampless/runtime": minor
"@ampless/plugin-schema-jsonld": patch
"create-ampless": patch
---

Phase 4 plugin extension: per-post body injection for JSON-LD.

Adds `publicBodyForPost?(post, ctx)` to `AmplessPlugin` (returns
`PublicPostBodyDescriptor[]` — `inlineScript` only with
`scriptType: 'application/ld+json'` REQUIRED) and
`Ampless.publicBodyForPost(post): Promise<ReactNode>` to the runtime so
themes render plugin-supplied descriptors keyed off the specific post
being viewed. First-party theme post templates updated to call it.

The `inlineScript` descriptor gains a `scriptType?:
'application/ld+json'` field usable on all three surfaces (`publicHead`
/ `publicBodyEnd` / `publicBodyForPost`); the runtime auto-escapes
`<`, `>`, `&`, U+2028, U+2029 in the body for that scriptType so
plugins cannot accidentally let a value break out of the script tag —
the same protection applies regardless of which surface emitted it.
Unsupported scriptType values are dropped with a warning (never
silently emitted as JS). The `publicBodyForPost` surface additionally
rejects `scriptType: undefined` to keep the per-post body scoped to
JSON-LD only — per-post arbitrary inline JS would need a new
capability rather than relaxing this constraint.

The `schema` capability is promoted from reserved to active and
participates in the same constructor-time capability-vs-implementation
mismatch warnings as Phase 3's `publicHead` / `publicBody`.

First bundled plugin: `@ampless/plugin-schema-jsonld` (untrusted)
emits Article-style structured data per post. Configurable via
`/admin/plugins`: articleType / authorName / publisherName /
publisherLogo. Designed for Google Rich Results.
