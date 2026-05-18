---
"create-ampless": patch
---

Fix `Auth UserPool not configured` error on `/login` and other top-level routes.

`templates/_shared/lib/amplify.ts` was previously a no-op shim, with a comment saying `<AdminProviders>` (mounted by the admin layout factory) would call `Amplify.configure()` on first render. But `/login` is a top-level route at `app/login/page.tsx`, outside the `(admin)` route group, so it never mounts AdminProviders. Anyone trying to sign up or sign in hit:

```
Auth UserPool not configured.
```

Restore the actual `Amplify.configure(outputs, { ssr: true })` side effect to `lib/amplify.ts`. Now imported from `app/providers.tsx` so it runs at the root of every page (public, login, admin), idempotent with the configure that AdminProviders also performs.

Existing scaffolds need to copy the updated `lib/amplify.ts` over.
