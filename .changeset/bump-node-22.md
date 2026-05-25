---
'create-ampless': patch
'ampless': patch
---

Bump documented Node.js requirement from `>=20` to `>=22` (current
active LTS as of 2026-05). Node 20 LTS active support ended
2026-04. The change is documentation + scaffold defaults:

- READMEs updated to state Node 22+.
- `templates/_shared/package.json` (shipped by `create-ampless`) now
  declares `engines.node: ">=22"`.
- All `defineFunction()` calls in `templates/_shared/amplify/` now
  explicitly set `runtime: 22` so the Lambdas Amplify provisions run
  on Node 22 rather than Amplify's "oldest LTS" default.

No source/API changes in the published library code — runtime
behaviour of the libraries themselves is unchanged on Node 22 vs 20.
