# @ampless/admin

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
