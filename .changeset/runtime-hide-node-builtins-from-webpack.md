---
"@ampless/runtime": patch
---

Fix `next build` crashing with `module-not-found` inside
`@ampless/runtime/dist/index.js` when projects bundle the Phase 5
plugin manifest reader.

`@ampless/runtime` is pulled into every Next.js bundle graph
(Server Component, App Route, Client Component Browser, Client
Component SSR) via `@ampless/admin`'s re-exports, so anything
top-level in `plugin-package-manifest.ts` lands in the browser
graph too. Webpack 5 rejected the module on **two** independent
grounds:

1. The static `import { readFileSync } from 'node:fs'` (tsup strips
   the `node:` prefix → `from "fs"`) is unresolvable in client
   bundles. Next.js does not polyfill Node built-ins for browser
   targets.
2. The literal `import.meta.resolve(<expr>)` call shape is
   hand-recognized by webpack 5 and treated as a static module
   request, which fails with `module-not-found` whenever the
   specifier is dynamic (which ours always is —
   `${packageName}/package.json`).

Both surfaces are now hidden from webpack:

- `node:fs` / `node:url` are loaded sync via Node 22+'s
  `process.getBuiltinModule(<name>)` — purpose-built for sync
  loading of built-ins from ESM without an `import` or `require`
  statement webpack can see. `ampless` already requires Node
  `>=22.13` so the API is always available on the server.
- `import.meta.resolve` is accessed via `import.meta.resolve.bind(...)`
  (a `.bind()` call, not a `.resolve()` call), which webpack
  leaves alone.

When neither API is available (browser bundles, older runtimes,
bundlers that strip `import.meta.resolve`), `loadPackageManifest`
returns `null` and the runtime falls back to the existing
per-factory mismatch checks — the same backward-compat path used
for plugins predating Phase 5. No public API change.

Tests rewritten to spy on `process.getBuiltinModule` instead of
`vi.mock('node:fs')` (the new code path bypasses vitest's module
resolver). 174/174 runtime tests pass; the dist now contains zero
`from "fs"` / `from "url"` imports and zero literal
`import.meta.resolve(...)` call expressions.
