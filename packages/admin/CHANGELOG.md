# @ampless/admin

## 0.2.0-alpha.11

### Patch Changes

- eaed85a: Move all admin-only page view bodies (`AdminDashboard`, `LoginPage`,
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

## 0.2.0-alpha.10

### Patch Changes

- 09a34c3: Fix `next build` "Server Components cannot use Client function" error on
  the `/login` route (and any route reachable from `@ampless/admin/pages`).

  `UsersListView` is imported only by `src/pages/users-list.tsx`, so tsup
  had no incentive to put it in a shared chunk and inlined it directly into
  `dist/pages/index.js`. The `preserveDirectives` plugin then saw a
  `'use client'` input among the entry's inputs and applied `'use client'`
  to the whole entry — making every page factory (`createLoginPage`,
  `createDashboardPage`, etc.) a Client function and breaking app router
  pages that `import { createLoginPage } from '@ampless/admin/pages'`.

  Fixed by adding `src/components/users-list-view.tsx` as a private tsup
  entry (mirroring how `src/lib/theme-actions.ts` is split so its
  `'use server'` directive survives bundling). This keeps the admin-only
  users view out of the public `@ampless/admin/components` barrel while
  giving esbuild a reason to emit it as a separate chunk that
  `dist/pages/index.js` imports across the server/client boundary cleanly.

  Supersedes the earlier alpha that exported `UsersListView` from the
  public barrel — that approach worked but widened the public surface
  with an admin-only component.

## 0.2.0-alpha.9

### Patch Changes

- 88cd069: Fix `next build` "Server Components cannot use Client function" error on
  the `/login` route (and any other route that imports `createUsersListPage`
  indirectly via `@ampless/admin/pages`).

  `UsersListView` was missing from `src/components/index.ts`'s barrel. As a
  result tsup had no reason to put it in a shared chunk and inlined it
  straight into `dist/pages/index.js`. The `preserveDirectives` plugin then
  saw a `'use client'` input among the entry's inputs and (correctly)
  applied `'use client'` to the whole entry — making every page factory
  (`createLoginPage`, `createDashboardPage`, etc.) a Client function. App
  Router `app/login/page.tsx` imports `createLoginPage` from a Server
  Component context, which Next.js 16 then rejects with:

  ```
  × You're importing a component that imports createLoginPage. It's
    in a client boundary, but no other client component imports it.
  ```

  The other `*-view.tsx` Client components were already in the barrel for
  exactly this reason (see the comment in `src/components/index.ts`).
  `UsersListView` was added later and slipped through.

## 0.2.0-alpha.8

### Minor Changes

- dbf0fb0: Add `format: 'static'` for ZIP / file-bundle landing pages.

  A "static" post is a directory of HTML / CSS / JS / image assets uploaded as a zip (or as loose files via the directory picker). The bundle is extracted into `public/static/<siteId>/<slug>/` in S3 and served verbatim by a new catch-all route handler at `app/site/[siteId]/[...path]/route.ts` — no theme chrome, no rewriting, just S3 → presigned URL → 302 redirect.

  **Hard constraint enforced at upload time**: every reference inside the bundle (HTML `src`/`href`/`srcset`, CSS `url()`/`@import`) must be **relative**. Absolute paths (`/foo`) and protocol-relative URLs (`//cdn.example/foo`) are flagged by the admin uploader before save. The constraint keeps the bundle portable — exactly the same files work whether you preview locally by opening `index.html` or deploy under any URL prefix. JS string paths aren't validated (too dynamic to verify); authors are responsible for keeping them relative too.

  Pieces:
  - `ContentFormat` gains `'static'`; the schema enum is widened (`Post.format` and `Page.format`).
  - New `StaticPostBody` interface (`entrypoint`, `files[]`, `uploadedAt`) — the body column is now the bundle's manifest; the actual bytes live in S3.
  - `@ampless/admin` ships `StaticUploader` (zip via JSZip, or loose-file directory picker). The component runs path validation + cross-file lint on extract and blocks save until issues are fixed. Switching format away from `static` in `PostForm` clears the pending bundle.
  - New `@ampless/runtime/routes#createStaticRouteHandler` factory. It looks up the post by slug, refuses non-static formats (defense in depth for direct `/raw-ish` URLs), and 302s to a 1-hour presigned URL via Amplify SSR.
  - Theme post dispatcher (`createThemePostDispatcher`) detects `format === 'static'` and 308-redirects to `/<slug>/<entrypoint>` so the URL ends in a real filename — that's what makes the browser resolve relative paths in the bundle under `/<slug>/…` instead of the site root.
  - `templates/_shared/app/site/[siteId]/[...path]/route.ts` is the wiring template projects ship.
  - Bundle delete cleans up the S3 prefix on post deletion or re-upload so removed files don't linger.

  Limitations:
  - Browser-side upload is capped at ~50 MB uncompressed. Larger bundles should land via direct S3 upload + admin-side metadata edit (out of scope for v1).
  - Slug name collisions matter: `og`, `raw`, `tag`, `feed.xml`, `sitemap.xml` are taken by other route handlers, so a static post can't use those as its slug.

### Patch Changes

- Updated dependencies [dbf0fb0]
  - ampless@0.2.0-alpha.3
  - @ampless/runtime@0.2.0-alpha.5

## 0.2.0-alpha.7

### Minor Changes

- 0f47d6e: Replace the `.html` slug-suffix convention for bare-HTML rendering with a data-driven `metadata.no_layout` toggle.

  `Post` gains a free-form `metadata` JSON column (DynamoDB `a.json()` + `PublicPost` customType + `PostMetadata` TS interface in `ampless`). The well-known key `no_layout: boolean` tells the runtime to serve the post as bare HTML (no theme chrome, no Next.js root layout). Other keys are passed through unchanged for plugin / app use.

  Behavioural changes:
  - **Middleware**: the `/(slug).html → /raw/(slug).html` rewrite is gone. Slugs ending in `.html` are now treated as ordinary post URLs. The slug-suffix shortcut never carried real semantics (middleware can't see post fields), so the data column is now the only source of truth.
  - **Theme post dispatcher**: peeks at `post.metadata.no_layout` before delegating. When true, redirects to `/raw/<slug>` so the raw route handler can emit the body directly (the browser URL settles on `/raw/<slug>`).
  - **Raw route handler**: also enforces `metadata.no_layout === true` and 404s otherwise. A direct `/raw/<slug>` request for a normal post no longer leaks the body without theme chrome.
  - **Admin post form**: adds a "no layout" checkbox that writes `metadata.no_layout`. The checkbox merges into existing metadata (plugin state etc. is preserved on save).

  Migration for posts published before this release: rename the slug (drop `.html`) and tick the new "no layout" checkbox in the admin. The old URL `/promo.html` will no longer auto-route to the raw handler — set the metadata flag and the post lives at `/raw/promo` instead.

### Patch Changes

- c5febac: Responsive admin layout: the sidebar collapses into a slide-in drawer below `md` (768px) with a sticky top bar and hamburger toggle, and turns back into a persistent 240px rail on tablets/desktops. The drawer auto-closes on route change and locks page scroll while open.

  Page bodies now use `mx-auto max-w-7xl p-4 md:p-8` so admin content centers on wide screens (previously page bodies stretched edge-to-edge with a fixed `p-8` and no max-width, which left forms anchored to the left of huge empty space and crushed under the sidebar on mobile). Page titles shrink to `text-2xl` below `md` to leave room for the action button next to them, and table containers gain `overflow-x-auto` so the posts / sites tables don't push out the viewport on narrow screens.

- Updated dependencies [1238898]
- Updated dependencies [0f47d6e]
  - ampless@0.2.0-alpha.2
  - @ampless/runtime@0.2.0-alpha.4

## 0.2.0-alpha.6

### Patch Changes

- Updated dependencies [55734e5]
  - @ampless/runtime@0.2.0-alpha.3

## 0.2.0-alpha.5

### Patch Changes

- 1e3fc43: Fix admin posts list / edit pages showing ampless's dummy `Hello, ampless` / `About ampless` / `Getting started` placeholders instead of the real data.

  `<AdminProviders>` ran `installAdminPostsProvider()` / `installAdminKvProvider()` from inside `useEffect`. React runs **child** useEffects before **parent** useEffects, so when a posts list page mounted, its own `useEffect → listPosts()` fired first — at that point ampless's global provider registry was still empty, so `listPosts` returned its built-in dummy posts. Same for `getPostById` on the edit page (returned `null` → 404).

  Move the registration calls out of `useEffect` and into the render body. They're idempotent (each install guards with an `installed` flag), so the synchronous call is safe during render, HMR remounts, etc. Now the provider is registered before any child component's effects run.

  Discovered via end-to-end Playwright session on the dogfood site: created a real post, saw it on the public home, then navigated to `/admin/posts` and got the dummy list back.

## 0.2.0-alpha.4

### Patch Changes

- e16a237: Fix `Variable 'body' has an invalid value` AppSync error when saving a markdown / HTML post.

  `encodeBody` short-circuited for string inputs and returned them as-is — but AppSync's AWSJSON scalar requires a JSON-encoded string on the wire. A raw markdown body like `# Hello` is not valid JSON; AppSync's validator rejects it.

  Always `JSON.stringify` on encode (including for strings, which become JSON string literals like `"# Hello"`). The decode side already handled both encoded and legacy bare strings via try/catch.

- d1a6045: Fix "The conditional request failed" DynamoDB error when saving a post that was published before the `PostTag` denormalized index existed.

  Symptom (from the dogfood site, ishinao.net): post-003 was status='published' since before the PostTag index was introduced, so no PostTag rows were ever written. Editing the post (e.g. changing `format` from markdown to tiptap) made `syncPostTags` compute the "update existing" branch from `oldPost.tags`, but AppSync's `update` mutation requires `attribute_exists(<PK>)` — and those rows weren't in DDB. Save failed with:

  ```
  The conditional request failed (Service: DynamoDb, Status Code: 400, ...)
  ```

  Make `syncPostTags` idempotent by switching both branches to upsert:
  - **New entries** (key only in newKeys): try `create` first; on conditional failure (orphan row left over from previous unclean delete) fall back to `update`.
  - **Existing entries** (key in both): try `update` first; on conditional failure (legacy post, row never created) fall back to `create`.

  Existing entries that no longer apply (delete branch) stay unchanged — `delete` is naturally idempotent.

  After this fix, legacy posts that were published before PostTag existed get their PostTag rows created automatically on first save.

- c3d73aa: Fix React Server Components serialization error when `cmsConfig.plugins` contained plugin instances (with non-serializable `hooks` functions).

  Symptom from the dogfood site:

  ```
  Runtime Error - Server

  Functions cannot be passed directly to Client Components unless you
  explicitly expose it by marking it with "use server". Or maybe you
  meant to call this function rather than return it.

    {content.published: function rebuild, content.unpublished: ..., ...}
  ```

  `createAdminLayout(admin)` passed `admin.cmsConfig` straight into the `<AdminProviders>` client component. Plugin instances in `cmsConfig.plugins` carry Lambda-side `hooks` (and `metadata`) functions that RSC's serializer cannot send across the server→client boundary.

  Strip plugin instances down to `{ name, apiVersion, trust_level }` before passing — admin's client-side state modules only read `cmsConfig.site` / `cmsConfig.sites` / `cmsConfig.media`, never plugin hooks, so the reduction is safe.

## 0.2.0-alpha.3

### Patch Changes

- bb66ea4: Move `AdminProviders` to `components/` so `dist/pages` stays server-side.

  `c8232a5` (preserve `'use client'` / `'use server'` directives) correctly tagged each output based on its inlined inputs, but `src/pages/` mixed server-side factories (`createAdminLayout`, `createSiteEditPage`, ...) with `'use client'` view modules (`dashboard.tsx`, `posts-list.tsx`, `admin-providers.tsx`, ...). That left `dist/pages/index.js` marked `'use client'`, and Next.js rejected `createAdminLayout(admin)` calls from Server Component shells with:

  > Attempted to call createAdminLayout() from the server but createAdminLayout is on the client.

  Fix:
  1. Move all `'use client'` view components out of `src/pages/` into `src/components/` (`admin-providers.tsx`, `admin-dashboard.tsx`, `posts-list-view.tsx`, `new-post-view.tsx`, `edit-post-view.tsx`, `media-view.tsx`, `login-view.tsx`). The files in `src/pages/` now hold only the server-side factory wrappers (`createAdminDashboardPage`, ...) that import the view across the boundary.
  2. Re-export the view components from `@ampless/admin/components` — both as an opt-in escape hatch and to keep tsup from inlining them back into `dist/pages/index.js`.
  3. Extract `ADMIN_SITE_COOKIE` into a directive-less `lib/admin-site-cookie.ts` so it can be shared between server-side `lib/admin-site.ts` and client-side `lib/admin-site-client.ts` without pulling the `'use client'` boundary into the locale/i18n chunk that `dist/index.js` consumes.
  4. Split `lib/theme-actions.ts` (`'use server'`) into its own tsup entry so it ends up in a dedicated `'use server'`-tagged file instead of getting mixed into the shared client-components chunk.
  5. Extend the `preserveDirectives` plugin in `tsup.config.ts` to also tag internal chunks whose inputs are purely `'use client'` (or purely `'use server'`). This is what lets `chunk-*-clients.js` ship a real boundary marker that Next.js can detect when a server-side `pages/index.js` imports a view component from it. Chunks that mix both directives are still left un-tagged with a warning.

  The public API of `@ampless/admin/pages` and `@ampless/admin/components` is unchanged — same factory names, same call shape.

## 0.2.0-alpha.2

### Patch Changes

- c8232a5: Preserve `'use client'` / `'use server'` directives in the tsup build.

  tsup (via esbuild) strips per-file directives when it concatenates source modules into a single output. That had been causing `TypeError: Class extends value undefined is not a constructor or null` whenever a Next.js server component imported from `@ampless/admin/pages` — the bundle was evaluated server-side and `react-image-crop`'s `ReactCrop` class blew up.

  A custom inline esbuild plugin in `packages/admin/tsup.config.ts` now:
  1. Taps `onLoad` to record which source files start with `'use client'` / `'use server'`.
  2. On build end, uses `metafile` to map each emitted output back to the source files inlined into it.
  3. Prepends the directive to entry outputs (`dist/pages/index.js`, `dist/components/index.js`) whose own direct inputs or — for pure re-export shim entries — whose imported chunks carry the directive.
  4. Leaves substantive server entries (`dist/index.js`, `dist/api/index.js`) and internal shared chunks untagged, so the server-side `createAdmin` factory can still consume constants from chunks shared with client code.

  Earlier off-the-shelf attempts (`rollup-plugin-preserve-directives`, `esbuild-plugin-preserve-directives`) didn't work with the current tsup / esbuild versions.

  The `'use client'` workaround in the templates' `components/i18n-provider.tsx` shim is now defensive — `dist/components/index.js` carries the directive itself — but harmless to keep.

- Updated dependencies [da08397]
  - @ampless/runtime@0.2.0-alpha.2

## 0.2.0-alpha.1

### Patch Changes

- 9f6adad: Bump all direct dependencies to latest majors so the alpha track isn't carrying a major version behind. Notable bumps:
  - `typescript` 5.9 → 6.0
  - `next` 15 → 16 (Amplify adapter-nextjs peer allows up to <17)
  - `@tiptap/*` 2.27 → 3.23 — editor API migration (BubbleMenu moved to `@tiptap/react/menus`, `tippyOptions` → `options` for Floating-UI)
  - `vitest` 2 → 4
  - `eslint` 9 → 10
  - `lucide-react` 0.469 → 1.16
  - `tailwind-merge` 2 → 3
  - `@jsquash/avif` 1 → 2
  - `@clack/prompts` 0.9 → 1.4
  - plus all minor / patch refreshes (turbo, @aws-sdk, changesets, @types/node, typescript-eslint, vite)

  Behavioural code changes:
  - `theme-actions.ts`: `revalidateTag` → `updateTag` (Next 16's read-your-own-writes variant for Server Actions)
  - `image-bubble-menu.tsx`: tiptap 3 import path + Floating-UI option shape
  - TS 6 strict-mode fixes (catch params, side-effect css import declaration)

- Updated dependencies [9f6adad]
  - ampless@0.2.0-alpha.1
  - @ampless/runtime@0.2.0-alpha.1

## 0.2.0-alpha.0

### Minor Changes

- Initial alpha release. Sets up the library architecture (runtime / admin / backend / plugins / cli / mcp-server) for upgrade-friendly install. Pre-1.0 — breaking changes possible in any minor version.

### Patch Changes

- Updated dependencies
  - ampless@0.2.0-alpha.0
  - @ampless/runtime@0.2.0-alpha.0
