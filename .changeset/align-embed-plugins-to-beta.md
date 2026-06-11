---
"@ampless/plugin-youtube": patch
"@ampless/plugin-x-embed": patch
---

Align the embed plugins with the beta channel.

Both plugins declare `ampless` as a peer dependency only, so the
beta-kickoff cut (which bumped `ampless` and its regular dependents)
left them on their last alpha versions with no `beta` dist-tag —
`npm install @ampless/plugin-x-embed@beta` 404s even though every
other package resolves on `@beta`. This empty patch moves them onto
`1.0.0-beta.*` so the whole package family lives on one channel.
