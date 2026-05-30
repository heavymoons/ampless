---
"create-ampless": patch
---

Add `@ampless/plugin-cookie-consent` to the standard plugin set so
that:

1. `templates/_shared/package.json` lists it as a dependency, so new
   scaffolds and `update-ampless` on existing sites bring it in
   automatically (same way all other first-party plugins are seeded).
2. The `AMPLESS_PACKAGES` allowlist in `upgrade.ts` includes it, so
   the merge path in `update-ampless` is wired up.
3. `templates/_shared/cms.config.ts` ships a commented-out
   `import cookieConsentPlugin from '@ampless/plugin-cookie-consent'`
   plus a commented-out registration block inside `plugins: [...]`,
   positioned **above** the analytics plugin blocks with a note
   that order matters (cookie-consent's `publicHead` must install
   `window.amplessConsent` before analytics' `afterInteractive`
   scripts read it).

`cms.config.ts` is in `PROTECTED_PATTERNS`, so existing sites keep
their hand-edited config. The discoverability win is for new
scaffolds — users see all the first-party plugins listed (commented
out) instead of having to read the README to know they exist.
