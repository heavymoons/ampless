---
"create-ampless": patch
---

Consolidate the alpha-period `create-ampless` template-sync history into
a single summary entry.

During alpha (2026 Q1 to Q2), every change to the `templates/_shared/`
tree triggered `scripts/sync-template-versions.mjs` to emit an auto-sync
patch changeset for `create-ampless` (so the scaffold tarball would
re-publish with the latest template snapshot). 64 such
`auto-sync-create-ampless-*.md` entries accumulated across the alpha
series; they have all been consumed and published under the existing
`1.0.0-alpha.N` line for `create-ampless`.

This entry replaces those 64 individual changesets on disk before the
beta dist-tag flip, so the eventual v1.0.0-stable CHANGELOG shows one
"alpha template-sync history" row instead of 64 noisy auto-sync rows.
The individual template changes that drove each sync are recoverable
from git history (`git log -- templates/_shared/`).

No new feature; pure history consolidation.
