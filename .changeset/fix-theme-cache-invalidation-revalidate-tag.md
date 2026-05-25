---
'@ampless/admin': patch
---

Fix `invalidateSiteSettingsCache()` server action failing with
"An unexpected response was received from the server." after admin
theme switches and site-setting saves.

Root cause: Next.js 16's `updateTag(tag)` is gated on
`workStore.page.endsWith('/route')`. The check has a TODO comment in
the Next.js source acknowledging it misfires for some server-action
contexts. In our case, `invalidateSiteSettingsCache` runs from a
`setTimeout` callback inside the admin theme-settings form (the 8s
delay that lets the trusted processor finish rebuilding the S3
cache before the page hard-reloads). That call path makes the gate
reject the action with error code E872, which surfaces client-side
as the unhelpful "An unexpected response..." message.

The action's effect was being lost: the post-reload page rendered
with the stale 60-second fetch cache, so even with the upstream IAM
fix (PR #116) admin reloads could still show a one-minute-old
theme.

Fix: switch from `updateTag('site-settings')` to the older, stable
`revalidateTag('site-settings', 'max')`. Same invalidation semantics
for our use case (we hard-reload the page right after, so we don't
need updateTag's read-your-own-writes guarantee), no workStore.page
gate, no spurious errors.
