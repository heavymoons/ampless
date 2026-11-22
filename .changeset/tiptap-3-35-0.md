---
"@ampless/admin": patch
"create-ampless": patch
"@ampless/plugin-youtube": patch
"@ampless/plugin-x-embed": patch
---

Bump all `@tiptap/*` to `^3.35.0` in lockstep (admin, the embed plugins' dev dependency, and the scaffold template). Tiptap packages peer-depend on exact sibling versions, so keeping them aligned installs a single `@tiptap/pm` / ProseMirror instance. Supersedes the Dependabot `@tiptap/core`-only bump (#363); tracked in #392.
