---
"ampless": minor
"create-ampless": patch
---

Reserve `PluginSettingsManifest.version?: number` for future
settings shape migration support (Phase 1 no-op).

Type changes:
- `PluginSettingsManifest` gains an optional `version?: number`
  field. The runtime does NOT read this today; declaring it is a
  forward-compatibility hint for when a future migration PR adds
  the version-comparison mechanism. Plugins that omit the field
  continue with the current lenient-resolver behaviour (field
  additions resolve via `default`, removals become orphan rows,
  type changes fall through to `default` on validation failure).
  Recommended values: positive integer, start at 1. The future
  migration PR may reserve special semantics for `0` / undefined
  (legacy / pre-v1), so plugin authors should not use `0`.

Documentation:
- `docs/architecture/08-plugin-architecture.md` (en + ja) gains a
  short "Settings shape evolution" note next to the existing
  Plugin State Storage table, describing today's lenient resolver
  behaviour and the version reservation.
- Plugin author guide (source-of-truth + template mirror, en + ja)
  gets a new "When you change settings shape" sub-section under
  the settings.public / settings.secret sections, with a code
  example showing `version: 2` declaration. The section is explicit
  about what this reservation does and does not promise: declaring
  `version` today positions the plugin to be picked up by the
  mismatch-detection path of a future migration PR, but does NOT
  pre-wire a migration body. The actual migration body (`migrate`
  hook or equivalent) is a separate future design, and plugins
  that want to provide a body will need to re-publish after that
  PR ships. Existing plugins that omit `version` are unaffected by
  this addition; the cost removed by this Phase 1 reservation is
  the cost a plugin author would otherwise pay to opt in to the
  future migration detection path — without this reservation, that
  opt-in would require a re-publish after the future PR ships
  just to add the `version` declaration. The migration body and
  the `migrate` hook signature are NOT reserved by this PR.
- The existing `AmplessPlugin` manifest snippet in the author guide
  (en + ja, source + template — 4 files) is also corrected: the
  inline shape was `settings?: { public?: ... }`, missing both
  `secret` (added in Phase 6a) and the new `version`. Updated to
  the full current shape.

No runtime behaviour change. No migration mechanism is included in
this PR — that requires its own design PR covering version
persistence storage location, mismatch detection, and the actual
migration invocation surface (a `migrate` hook or an admin-driven
flow, TBD).
