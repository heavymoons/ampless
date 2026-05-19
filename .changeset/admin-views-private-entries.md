---
"@ampless/admin": patch
---

Move all admin-only page view bodies (`AdminDashboard`, `LoginPage`,
`MediaPage`, `EditPostPage`, `NewPostPage`, `PostsList`,
`UsersListView`) out of the public `@ampless/admin/components` barrel
and into private `tsup.config.ts` entries.

Why: the previous barrel exports served a dual purpose — opt-in escape
hatch + tsup chunk splitting. The escape-hatch reason was wrong for
admin-only opinionated page bodies: nobody outside the admin pages
factories has a legitimate reason to embed `LoginPage` or `MediaPage`
on their own. The chunk-splitting reason is fully satisfied by private
entries (same pattern `src/lib/theme-actions.ts` uses), so the public
surface can shrink without re-introducing the inlining problem that
caused `'use client'` to bleed onto `dist/pages/index.js` and break the
server-side page factories.

Behavior:

- `dist/pages/index.js` stays server-safe (no `'use client'` directive,
  no client-component inputs).
- View components emit as `dist/components/{admin-dashboard,login-view,
  media-view,edit-post-view,new-post-view,posts-list-view,
  users-list-view}.js`, each marked `"use client";`.
- `dist/components/index.js` (the public barrel) no longer exports view
  components — only providers, forms, and utilities remain.

No external consumer in this monorepo's templates imports any of the
removed view exports, so this is a non-breaking change for first-party
users. External consumers (if any) that imported these from
`@ampless/admin/components` should switch to using the page factories
(`@ampless/admin/pages`) which is the supported integration point.
