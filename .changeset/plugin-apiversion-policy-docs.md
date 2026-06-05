---
"ampless": patch
"create-ampless": patch
---

Document the apiVersion bump policy for plugin authors and ampless
maintainers, and rewrite three pre-existing pieces of doc/JSDoc that
contradict the new policy.

No runtime behaviour change.

New policy doc:
- `docs/architecture/08-plugin-architecture.md` (en + ja, top-level
  docs/, NOT in any npm tarball) gain a new "apiVersion bump policy"
  section covering: the role of apiVersion as a breaking-change
  marker, today's runtime behaviour (hard throw on mismatch,
  SUPPORTED_API_VERSION = 1), the additive-vs-breaking line with
  concrete examples on each side, confirmation that all five Phase 1
  compat-break reservations (PRs #220, #222, #230, #232, #234) land
  within apiVersion: 1, the beta-period policy of holding apiVersion
  at 1 while npm package versions bump freely, a deferred decision
  on dual-version support (v1 + v2 coexistence vs hard cut), and a
  deliberately-uncommitted list of candidate changes that would, in
  their current shape, require a future apiVersion: 2 bump.

Brief author-facing summary + link:
- `packages/ampless/docs/plugin-author-guide.md` + .ja.md and
  `templates/_shared/docs/plugin-author-guide.md` + .ja.md gain a
  brief matching paragraph under their existing `apiVersion: 1`
  section, with a GitHub absolute-URL link to the architecture doc
  for the full policy.

Rewriting pre-existing contradictory text in the same four guide
files:
- The `### apiVersion: 1` inline comment (`// bump only when the
  contract changes` / `// 契約が変わるときだけ bump`) is reworded
  to `// the only valid value today` / `// 現状唯一の有効値` so
  the inline form does not invite plugin authors to declare values
  other than 1.
- The §12 "Publishing to npm" `apiVersion` bullet previously
  promised a semver-style channel ("bump major when an existing
  field's type changes; bump minor when you add a new field"). That
  shape contradicts the new policy (apiVersion is the breaking-
  change marker, additive changes stay within v1). Rewritten to
  describe the breaking-change-marker semantics with a link to the
  architecture doc's full criteria.

JSDoc rewrite (visible in ampless DTS):
- `AmplessPlugin.apiVersion` JSDoc in `packages/ampless/src/plugin.ts`
  previously said "Currently 1; future versions will be additive",
  which reads as "future apiVersion values themselves will be an
  additive sequence" — the opposite of the new policy. Rewritten to
  describe apiVersion as the breaking-change marker on the plugin
  contract, with additive changes staying within apiVersion: 1.

The literal type `apiVersion: 1`, `SUPPORTED_API_VERSION = 1`, and
the cross-check throw behaviour are all unchanged. This patch only
documents the existing semantics, codifies the maintainer-facing
policy for when apiVersion would bump, and brings three pre-existing
strings into agreement with that policy.
