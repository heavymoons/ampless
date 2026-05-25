---
'@ampless/runtime': minor
'@ampless/admin': minor
---

Replace the blind 8-second post-switch timer in the admin theme-
switcher with active polling against the S3 site-settings cache.

After the user clicks "Switch theme," the form now waits until the
trusted processor has actually rebuilt `public/site-settings.json`
with the new `theme.active` value before invalidating the public-
side cache tag and hard-reloading. The old design fired a fixed
8 s `setTimeout` and then reloaded — if the processor happened to
take longer (cold-start Lambdas, slow DDB read), the reload landed
before S3 reflected the change and the admin showed the pre-switch
theme for up to the Next.js fetch cache TTL (~60 s).

New plumbing:

- `Ampless.readStoredActiveThemeFresh()` (`@ampless/runtime`):
  reads `public/site-settings.json` with `cache: 'no-store'`,
  returns the raw stored theme name. Bypasses the Next.js fetch
  cache so polling sees the literal current S3 state.
- `Admin.readStoredActiveThemeFresh()` (`@ampless/admin`):
  thin passthrough to the runtime helper.
- `createSiteThemePage` defines an inline `'use server'` action
  `pollActiveTheme(expected)` that loops on the fresh-read helper
  (1 s × 30 attempts, 30 s budget) and resolves to `true` on
  match, `false` on timeout. Passed to `ThemeSettingsForm` as a
  prop.
- `ThemeSettingsForm` switches its post-save flow from
  `setTimeout` + reload to `pollActiveTheme` → cache invalidate →
  reload. The "Switching…" button stays disabled for the entire
  poll so the UI matches what's actually happening.

Manifest field saves still use the existing 8 s
`scheduleCacheInvalidation` path — they don't reload, the user
sees their typed values immediately, and the timer just controls
how soon visitors pick up the change. A user-visible failure mode
matching the switch case doesn't apply.

This depends on the upstream IAM fix (#116) for the processor's
`s3:PutObject` to succeed in the first place — without it the
poll would always time out.
