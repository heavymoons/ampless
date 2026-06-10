---
"@ampless/admin": patch
---

Fix user-site build failure: `TiptapExtensionLike` no longer carries an
index signature, so real tiptap `Node` / `Mark` / `Extension` class
instances are assignable to `installAdminEditorExtensions`.

Amplify Hosting builds of user sites started failing Next.js typecheck
on the codegen'd `_editor-bootstrap.tsx`:

```
Type error: Type 'Node<any, any>' is not assignable to type 'TiptapExtensionLike'.
Index signature for type 'string' is missing in type 'Node<any, any>'.
```

TypeScript class instances don't get implicit index signatures, so the
`readonly [key: string]: unknown` member on `TiptapExtensionLike` made
every plugin's `editorExtension` (a tiptap `Node` instance) fail the
assignment. The mismatch was latent — it only surfaced once
`@ampless/admin` gained `@tiptap/core` as a direct dependency, which
let the plugin `.d.ts` types resolve to the real `Node<any, any>` class
in user-site installs instead of collapsing to `any`.

The type is now the minimal structural shape the admin actually uses
(`{ readonly name?: string }` — duplicate detection only; instances
pass through to `useEditor({ extensions })` untouched). It deliberately
stays structural rather than `AnyExtension` so extension instances from
a duplicated `@tiptap/core` copy in a user site's node_modules still
typecheck. A regression test passes real `Node.create()` instances
without casts; the test file is covered by `tsc --noEmit` lint.
