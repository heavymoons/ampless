---
"@ampless/backend": minor
"ampless": minor
"@ampless/runtime": minor
"@ampless/admin": minor
---

Replace the `.html` slug-suffix convention for bare-HTML rendering with a data-driven `metadata.no_layout` toggle.

`Post` gains a free-form `metadata` JSON column (DynamoDB `a.json()` + `PublicPost` customType + `PostMetadata` TS interface in `ampless`). The well-known key `no_layout: boolean` tells the runtime to serve the post as bare HTML (no theme chrome, no Next.js root layout). Other keys are passed through unchanged for plugin / app use.

Behavioural changes:

- **Middleware**: the `/(slug).html → /raw/(slug).html` rewrite is gone. Slugs ending in `.html` are now treated as ordinary post URLs. The slug-suffix shortcut never carried real semantics (middleware can't see post fields), so the data column is now the only source of truth.
- **Theme post dispatcher**: peeks at `post.metadata.no_layout` before delegating. When true, redirects to `/raw/<slug>` so the raw route handler can emit the body directly (the browser URL settles on `/raw/<slug>`).
- **Raw route handler**: also enforces `metadata.no_layout === true` and 404s otherwise. A direct `/raw/<slug>` request for a normal post no longer leaks the body without theme chrome.
- **Admin post form**: adds a "no layout" checkbox that writes `metadata.no_layout`. The checkbox merges into existing metadata (plugin state etc. is preserved on save).

