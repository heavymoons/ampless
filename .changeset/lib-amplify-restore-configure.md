---
"create-ampless": patch
---

Fix `Auth UserPool not configured` error on `/login` and other top-level routes.

`templates/_shared/lib/amplify.ts` now performs the actual
`Amplify.configure(outputs, { ssr: true })` side effect. It is
imported from `app/providers.tsx` so it runs at the root of every
page (public, login, admin), idempotent with the configure that
AdminProviders also performs.
