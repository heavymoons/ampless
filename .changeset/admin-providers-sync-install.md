---
"@ampless/admin": patch
---

Fix admin posts list / edit pages showing ampless's dummy `Hello, ampless` / `About ampless` / `Getting started` placeholders instead of the real data.

`<AdminProviders>` ran `installAdminPostsProvider()` / `installAdminKvProvider()` from inside `useEffect`. React runs **child** useEffects before **parent** useEffects, so when a posts list page mounted, its own `useEffect → listPosts()` fired first — at that point ampless's global provider registry was still empty, so `listPosts` returned its built-in dummy posts. Same for `getPostById` on the edit page (returned `null` → 404).

Move the registration calls out of `useEffect` and into the render body. They're idempotent (each install guards with an `installed` flag), so the synchronous call is safe during render, HMR remounts, etc. Now the provider is registered before any child component's effects run.

Discovered via end-to-end Playwright session on the dogfood site: created a real post, saw it on the public home, then navigated to `/admin/posts` and got the dummy list back.
