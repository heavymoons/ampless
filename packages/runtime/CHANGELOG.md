# @ampless/runtime

## 0.2.0-alpha.4

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

- Updated dependencies [1238898]
- Updated dependencies [0f47d6e]
  - ampless@0.2.0-alpha.2
  - @ampless/plugin-og-image@0.2.0-alpha.2

## 0.2.0-alpha.3

### Patch Changes

- 55734e5: Fix `next build` type error on scaffolded thin-shell page files:

  ```
  Type 'ThemePostDispatcher' is not assignable to type 'FunctionComponent<any>'.
  Type 'Promise<unknown>' is not assignable to type 'Promise<AwaitedReactNode>'.
  ```

  The L1 extraction typed the three theme dispatcher return values as `Promise<unknown>` to avoid pulling React into ampless core. But `next build` (Next.js 16's stricter type-check pass) rejects this at the App Router page-default-export site.

  Narrow the dispatchers' return type to `Promise<React.ReactNode>` via the `react` peer dep. Runtime semantics unchanged; the returned value already is a server component render result.

  Surfaced via Amplify Hosting build for the dogfood site `ampless.heavymoons.net`.

## 0.2.0-alpha.2

### Patch Changes

- da08397: Inline the proxy matcher config in scaffolded `proxy.ts`. Next.js 16's Turbopack requires `export const config` in middleware/proxy files to be a statically analysable object literal — referencing an imported variable (like `defaultMatcherConfig` from `@ampless/runtime/middleware`) fails the build:

  ```
  Next.js can't recognize the exported `config` field in route.
  It needs to be a static object.
  ```

  Drop the re-export pattern and inline the matcher array in the scaffold. `defaultMatcherConfig` stays exported from `@ampless/runtime/middleware` as a documentation reference (with a JSDoc note explaining the Turbopack constraint), but isn't used by the scaffold anymore.

  Existing scaffolds need to edit their `proxy.ts` (or `middleware.ts`) to inline `config = { matcher: [...] }` directly.

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
  - @ampless/plugin-og-image@0.2.0-alpha.1

## 0.2.0-alpha.0

### Minor Changes

- Initial alpha release. Sets up the library architecture (runtime / admin / backend / plugins / cli / mcp-server) for upgrade-friendly install. Pre-1.0 — breaking changes possible in any minor version.

### Patch Changes

- Updated dependencies
  - ampless@0.2.0-alpha.0
  - @ampless/plugin-og-image@0.2.0-alpha.0
