---
"@ampless/runtime": patch
---

Fix `next build` crashing with `module-not-found` inside
`@ampless/runtime/dist/index.js` when projects upgrade past the
release that introduced static plugin manifest cross-checking.

The Phase 5 manifest reader calls `import.meta.resolve(<packageName>/package.json)`
inside `loadPackageManifest`. Webpack 5 (and therefore Next.js) has a
hand-written recognizer for the literal `import.meta.resolve(<expr>)`
call shape and tries to follow it as a static module request. Our
specifier is always a template literal built from a runtime argument,
so webpack can't resolve it at build time and emits a hard
`module-not-found` error — blocking every site that bundles the
runtime, including the Amplify Hosting builds.

The runtime behavior is correct (Node 22+ resolves the specifier
fine, and the surrounding try/catch handles every documented failure
mode). The fix is structural: read `import.meta.resolve` once into a
local variable (`metaResolve`) and call through that binding. Webpack
only flags the literal `import.meta.resolve(...)` call shape, so the
indirection makes the call site invisible to its static analyzer
while leaving Node resolution intact. When `import.meta.resolve` is
unavailable (older runtimes, bundlers that strip it), `metaResolve`
is `undefined` and `loadPackageManifest` returns `null` — the
existing per-factory mismatch check still runs.

No public API change. Existing runtime tests (174/174) cover both
the success and `null` fallback paths.
