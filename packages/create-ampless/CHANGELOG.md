# create-ampless

## 0.2.0-alpha.4

### Patch Changes

- 8695647: Fix `Auth UserPool not configured` error on `/login` and other top-level routes.

  `templates/_shared/lib/amplify.ts` was previously a no-op shim, with a comment saying `<AdminProviders>` (mounted by the admin layout factory) would call `Amplify.configure()` on first render. But `/login` is a top-level route at `app/login/page.tsx`, outside the `(admin)` route group, so it never mounts AdminProviders. Anyone trying to sign up or sign in hit:

  ```
  Auth UserPool not configured.
  ```

  Restore the actual `Amplify.configure(outputs, { ssr: true })` side effect to `lib/amplify.ts`. Now imported from `app/providers.tsx` so it runs at the root of every page (public, login, admin), idempotent with the configure that AdminProviders also performs.

  Existing scaffolds need to copy the updated `lib/amplify.ts` over.

## 0.2.0-alpha.3

### Patch Changes

- da08397: Inline the proxy matcher config in scaffolded `proxy.ts`. Next.js 16's Turbopack requires `export const config` in middleware/proxy files to be a statically analysable object literal — referencing an imported variable (like `defaultMatcherConfig` from `@ampless/runtime/middleware`) fails the build:

  ```
  Next.js can't recognize the exported `config` field in route.
  It needs to be a static object.
  ```

  Drop the re-export pattern and inline the matcher array in the scaffold. `defaultMatcherConfig` stays exported from `@ampless/runtime/middleware` as a documentation reference (with a JSDoc note explaining the Turbopack constraint), but isn't used by the scaffold anymore.

  Existing scaffolds need to edit their `proxy.ts` (or `middleware.ts`) to inline `config = { matcher: [...] }` directly.

## 0.2.0-alpha.2

### Patch Changes

- ce0abd0: Fix `TypeError: Class extends value undefined is not a constructor or null` from `components/i18n-provider.tsx` shim when imported from a server module.

  Root cause: tsup (via esbuild) strips per-file `'use client'` directives during the `@ampless/admin` build. When `app/layout.tsx` imports the shim from a server context, Next.js tries to evaluate the React-hook-using `I18nProvider` body in the RSC server runtime and crashes.

  Add `'use client'` to `templates/_shared/components/i18n-provider.tsx` so the shim itself is a client boundary; Next.js then bundles the re-exported admin components as client code and never tries to evaluate them server-side.

  Existing scaffolds need to copy this edit (add `'use client'` to their `components/i18n-provider.tsx`).

  Also tried installing `rollup-plugin-preserve-directives` and `esbuild-plugin-preserve-directives` in the admin build pipeline; neither is compatible with current tsup/esbuild versions. The shim-side fix is sufficient for now since all current consumers go through it.

- 1608b88: Fix second TDZ trap: `lib/admin.ts` was passing the `ampless` runtime instance to `createAdmin`, which read the binding eagerly at module init. Under the circular chain (`lib/ampless.ts` → themes-registry → theme pages → `lib/i18n.ts` → `lib/admin.ts`), `ampless` is still in its TDZ when admin.ts evaluates and crashes.

  Dropped the `ampless` parameter from the `createAdmin` call in `templates/_shared/lib/admin.ts`. `createAdmin` builds its own internal runtime instance when omitted (per L2's optional-param design), which is functionally equivalent for admin's needs — admin manages content and doesn't render themed pages, so it doesn't need theme resolution from the public-side ampless.

  Also defensively wrapped `templates/_shared/lib/i18n.ts`'s `export const t = admin.t` in an arrow function so future circular paths through i18n don't reintroduce a TDZ.

  Existing scaffolds need to copy these two edits over from the updated templates.

- 93ea408: Rename scaffolded `middleware.ts` → `proxy.ts` to match Next.js 16's renamed file convention, and update the exported binding from `middleware` to `proxy`. Next 16 emits a deprecation warning on `middleware.ts` and the rename silences it.

  The runtime helper `createAmplessMiddleware` keeps its name for API stability (the package-side name doesn't drive Next's file convention).

  Existing scaffolds need to rename their `middleware.ts` file to `proxy.ts` and rename the `middleware` export to `proxy`.

- ac7e642: Fix `Cannot access 'ampless' before initialization` ReferenceError that crashed scaffolded sites at request time.

  The back-compat shims in `templates/_shared/lib/{posts-public,site-settings,seo,storage,theme-active,theme-config,admin-site,auth-server}.ts` used `ampless.X.bind(ampless)` / `admin.X.bind(admin)` to re-export methods. That eagerly reads the `ampless` (or `admin`) binding at module evaluation, which loses against the circular import chain:

  ```
  lib/ampless.ts
    → ../themes-registry
      → ../themes/<name>/index.ts
        → ../themes/<name>/pages/home.tsx
          → @/lib/posts-public  (the shim)
            → @/lib/ampless     ← still in TDZ here
  ```

  Replaced every `.bind(X)` with an arrow function wrapper (`(...args) => X.method(...args)`) so the binding is read at call time instead. Existing scaffolds need to apply the same edit to their `lib/*.ts` files (or copy from the updated templates).

  Discovered when sandbox-deploying the first dogfood site against alpha.1.

## 0.2.0-alpha.1

### Patch Changes

- 6e25202: **Breaking:** Replace `defineAmplessAuth` / `defineAmplessStorage` with `amplessAuthConfig` / `amplessStorageConfig` config-builder helpers. The Amplify factory call (`defineAuth` / `defineStorage`) now happens in the user's `amplify/{auth,storage}/resource.ts` directly.

  Amplify Gen 2's import-path verifier inspects the stack trace of `defineAuth` / `defineData` / `defineStorage` and requires the call to originate from `amplify/{auth,data,storage}/resource.ts`. Wrapping those factories in this package made every `ampx sandbox` / deploy fail with `Amplify Auth must be defined in amplify/auth/resource.ts`. Returning a config object instead lets the user invoke the Amplify factory from the canonical location.

  Migration in `amplify/auth/resource.ts`:

  ```ts
  // before
  import { defineAmplessAuth } from '@ampless/backend'
  export const auth = defineAmplessAuth({ postConfirmation })

  // after
  import { defineAuth } from '@aws-amplify/backend'
  import { amplessAuthConfig } from '@ampless/backend'
  export const auth = defineAuth(amplessAuthConfig({ postConfirmation }))
  ```

  Same shape for `amplify/storage/resource.ts` (`defineStorage(amplessStorageConfig())`). The `templates/_shared/amplify/{auth,storage}/resource.ts` shells in `create-ampless` have been updated, so new scaffolds pick this up automatically.

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

## 0.2.0-alpha.0

### Minor Changes

- Initial alpha release. Sets up the library architecture (runtime / admin / backend / plugins / cli / mcp-server) for upgrade-friendly install. Pre-1.0 — breaking changes possible in any minor version.

## 0.1.0

### Minor Changes

- v0.1.0 — initial public MVP release.
  - `create-ampless` CLI: scaffolds a Next.js 15 (App Router) blog with the
    Amplify Gen 2 backend definitions baked in.
  - `ampless` core library: shared types, plugin contract (`definePlugin`,
    hooks, `PluginRuntimeContext`), event types, and helpers (`escapeXml`,
    `formatPublicAssetUrl`, `formatDate`, `processImage`, `defineSchema`,
    `defineConfig`).
  - `@ampless/plugin-seo`: OGP / Twitter / canonical metadata for posts and
    the site, plus a `sitemap.xml` regenerated to S3 on every content event.
  - `@ampless/plugin-rss`: RSS 2.0 `/feed.xml` regenerated to S3 on every
    content event, with `<language>` tag and per-call options.
  - `@ampless/plugin-webhook`: POST event payloads to external URLs with
    optional HMAC-SHA-256 signing.
  - `@ampless/mcp-server`: stdio MCP server (Claude Desktop / Cursor /
    Claude Code) exposing 7 tools — list / get / create / update / delete
    posts, upload media, get schema. Authenticates as a Cognito user via
    SRP, so each tool runs with that user's role.
  - Trust-level event system: DynamoDB Streams → event-dispatcher Lambda →
    trusted / untrusted SQS queues → trust-level processor Lambdas. Plugin
    hooks fire in the matching trust level.
  - AppSync API key auto-renewal Lambda runs monthly (EventBridge Rule), so
    the public read path never silently 401s on key expiry.
