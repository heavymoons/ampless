# @ampless/admin

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
