---
"ampless": minor
"@ampless/backend": patch
---

Reserve `PluginHookResult` return type for `PluginEventHandler`
(Phase 1 no-op).

- New `PluginHookResult` interface exported from `ampless`. Carries
  a private `readonly __amplessPluginHookResult?: never` marker so
  that `Promise<void | PluginHookResult>` does not silently accept
  unrelated promise types (`Promise<string>`, `Promise<number>`,
  etc.) — only `void` / `undefined` / objects matching the structural
  shape pass.
- `PluginEventHandler` return type widens from `Promise<void>` to
  `Promise<void | PluginHookResult>`. Existing plugins returning
  `Promise<void>` remain type-compatible (covariant Promise) and
  need no migration.
- The first concrete directive expected to land on `PluginHookResult`
  is an optional `metrics?: Record<string, number>` field for
  observability emission. Rewrite-style directives (cancel, post
  rewrite) would also require `before:*` event support and payload
  extensions, neither of which is in scope for this PR.

Runtime behaviour does not change. Both trusted and untrusted event
processors continue to `await hook(...)` and discard the return
value. Comment-only edits in processor-trusted.ts /
processor-untrusted.ts document the reservation at the call sites.
