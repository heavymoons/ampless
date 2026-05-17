---
"create-ampless": patch
---

Fix `TypeError: Class extends value undefined is not a constructor or null` from `components/i18n-provider.tsx` shim when imported from a server module.

Root cause: tsup (via esbuild) strips per-file `'use client'` directives during the `@ampless/admin` build. When `app/layout.tsx` imports the shim from a server context, Next.js tries to evaluate the React-hook-using `I18nProvider` body in the RSC server runtime and crashes.

Add `'use client'` to `templates/_shared/components/i18n-provider.tsx` so the shim itself is a client boundary; Next.js then bundles the re-exported admin components as client code and never tries to evaluate them server-side.

Existing scaffolds need to copy this edit (add `'use client'` to their `components/i18n-provider.tsx`).

Also tried installing `rollup-plugin-preserve-directives` and `esbuild-plugin-preserve-directives` in the admin build pipeline; neither is compatible with current tsup/esbuild versions. The shim-side fix is sufficient for now since all current consumers go through it.
