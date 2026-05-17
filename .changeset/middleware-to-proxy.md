---
"create-ampless": patch
---

Rename scaffolded `middleware.ts` → `proxy.ts` to match Next.js 16's renamed file convention, and update the exported binding from `middleware` to `proxy`. Next 16 emits a deprecation warning on `middleware.ts` and the rename silences it.

The runtime helper `createAmplessMiddleware` keeps its name for API stability (the package-side name doesn't drive Next's file convention).

Existing scaffolds need to rename their `middleware.ts` file to `proxy.ts` and rename the `middleware` export to `proxy`.
