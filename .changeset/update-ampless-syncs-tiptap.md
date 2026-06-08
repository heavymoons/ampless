---
"create-ampless": patch
---

`create-ampless upgrade` (also known as `update-ampless`) now syncs
`@tiptap/*` package versions from the `_shared` template into the
consumer site's `package.json`, alongside `@ampless/*` packages. The
template now also declares `@tiptap/core` as a direct dependency so
the sync covers every tiptap package the new embed plugins
peer-require.

Why: `@ampless/admin` and the new embed plugins (`@ampless/plugin-youtube`,
`@ampless/plugin-x-embed`) require `@tiptap/core@^3`. Existing sites on
tiptap v2 would hit ERESOLVE peer-conflict errors when installing the
new plugins. The managed-transitive-deps mechanism keeps tiptap in
lockstep with what `@ampless/admin` peer-requires, so a single
`npm run update-ampless` brings the site fully in sync.

Also adds `@ampless/plugin-youtube` and `@ampless/plugin-x-embed` to
the managed `@ampless/*` allowlist for future template adoption (no
behavioural change until a template starts depending on them).
