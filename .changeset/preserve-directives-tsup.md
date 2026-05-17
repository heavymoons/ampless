---
"@ampless/admin": patch
---

Preserve `'use client'` / `'use server'` directives in the tsup build.

tsup (via esbuild) strips per-file directives when it concatenates source modules into a single output. That had been causing `TypeError: Class extends value undefined is not a constructor or null` whenever a Next.js server component imported from `@ampless/admin/pages` — the bundle was evaluated server-side and `react-image-crop`'s `ReactCrop` class blew up.

A custom inline esbuild plugin in `packages/admin/tsup.config.ts` now:

1. Taps `onLoad` to record which source files start with `'use client'` / `'use server'`.
2. On build end, uses `metafile` to map each emitted output back to the source files inlined into it.
3. Prepends the directive to entry outputs (`dist/pages/index.js`, `dist/components/index.js`) whose own direct inputs or — for pure re-export shim entries — whose imported chunks carry the directive.
4. Leaves substantive server entries (`dist/index.js`, `dist/api/index.js`) and internal shared chunks untagged, so the server-side `createAdmin` factory can still consume constants from chunks shared with client code.

Earlier off-the-shelf attempts (`rollup-plugin-preserve-directives`, `esbuild-plugin-preserve-directives`) didn't work with the current tsup / esbuild versions.

The `'use client'` workaround in the templates' `components/i18n-provider.tsx` shim is now defensive — `dist/components/index.js` carries the directive itself — but harmless to keep.
