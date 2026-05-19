---
'create-ampless': patch
---

`update-ampless` / `copy-theme` template scripts (and help / log text) now use `npx create-ampless@latest …` instead of `@alpha`. The published `alpha` dist tag had been stuck on `0.2.0-alpha.0` (changesets/action only updates `latest` on publish), so `npx create-ampless@alpha upgrade` was silently resolving to the pre-`upgrade` version of the CLI and falling through to the scaffolding prompts. `latest` is what changesets actually publishes to, so pointing at it works for both pre-release and stable lines.

A new `scripts/sync-alpha-dist-tag.mjs` runs after `changeset publish` in the release script. When in pre-release mode it re-tags every just-published workspace package as `alpha = <current version>`, so `npx <pkg>@alpha` keeps resolving to the same thing as `@latest`. The script no-ops out of pre mode so the alpha tag deliberately freezes when the project exits to stable.
