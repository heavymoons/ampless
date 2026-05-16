# @ampless/backend

## 0.2.0-alpha.1

### Minor Changes

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

## 0.2.0-alpha.0

### Minor Changes

- Initial alpha release. Sets up the library architecture (runtime / admin / backend / plugins / cli / mcp-server) for upgrade-friendly install. Pre-1.0 — breaking changes possible in any minor version.

### Patch Changes

- Updated dependencies
  - ampless@0.2.0-alpha.0
