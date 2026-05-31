---
"@ampless/plugin-cookie-consent": minor
"ampless": patch
---

Phase 3b polish after the dogfood pass on ishinao.net.

**`@ampless/plugin-cookie-consent`** — new `saveLabel` setting field.
The "Save selected" button on the consent banner was the only one
without an admin-editable / localisable label. Sites running in
Japanese (or any non-English locale) had a stray English button
sitting next to a Japanese accept / reject pair. Default is `'Save selected'`
so existing sites' visible label is preserved.

**Docs alignment after Phase 3b shipped.** Several places still
described cookie-consent + `consentCategory` as deferred / coming
in a future PR. Updated to "shipped" tense:

- `packages/plugin-cookie-consent/README.md` + `README.ja.md` —
  "Combining with analytics plugins (coming in PR D)" section
  becomes "Combining with analytics plugins"; the inline
  `// PR D — coming soon` comment is replaced with a working
  `analyticsGa4Plugin({ ..., consentCategory: 'analytics' })`
  example.
- `docs/architecture/14-roadmap.md` + `.ja.md` — Phase 3b status
  flips from "deferred until a real cookie-consent need appears"
  to a one-line completion summary; Phase 5 status (the previous
  closure) is also moved from `[ ]` to `[x]` with its dogfood
  summary.
- `docs/architecture/09-plugin-distribution.md` + `.ja.md` — the
  bullet under "future additions" listing cookie-consent as a
  dogfood candidate becomes a present-tense entry under the
  first-party plugin list, describing the `window.amplessConsent`
  API + `consentCategory` gating that's now live.

`ampless` is bumped patch because the architecture docs ship in the
`ampless` npm tarball.
