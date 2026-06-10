'use client'

// Registration store for tiptap extensions that first-party plugins
// (e.g. `@ampless/plugin-youtube/editor`) want the admin editor to
// load on top of its built-in extension list. Templates wire it up
// once in `_editor-bootstrap.tsx`:
//
//   'use client'
//   import { installAdminEditorExtensions } from '@ampless/admin/editor'
//   import { youtubeEditor } from '@ampless/plugin-youtube/editor'
//   import { tweetEditor } from '@ampless/plugin-x-embed/editor'
//
//   export function EditorBootstrap({ children }) {
//     installAdminEditorExtensions([
//       youtubeEditor.extension,
//       tweetEditor.extension,
//     ])
//     return <>{children}</>
//   }
//
// Then thread `<EditorBootstrap>` into `createAdminLayout(admin, {
// editorBootstrap: EditorBootstrap })`.

/**
 * Structural type for a tiptap extension instance. Deliberately NOT
 * `AnyExtension` from `@tiptap/core` even though admin now depends on
 * it directly: user sites can end up with duplicate `@tiptap/core`
 * copies (npm dedup failures across plugin/admin dependency trees),
 * and a nominal type would make cross-copy extension instances fail
 * to typecheck. A minimal structural shape stays robust.
 *
 * Deliberately NO index signature: TypeScript class instances (tiptap
 * `Node` / `Mark` / `Extension`) don't get implicit index signatures,
 * so `readonly [key: string]: unknown` here makes the codegen'd
 * `_editor-bootstrap.tsx` in user sites fail Next.js typecheck with
 * "Index signature for type 'string' is missing in type 'Node<any, any>'".
 * The admin only ever reads `name` (duplicate detection) and passes the
 * instance through to <TiptapEditor>'s `useEditor({ extensions })`
 * spread untouched.
 */
export interface TiptapExtensionLike {
  readonly name?: string
}

let extensions: readonly TiptapExtensionLike[] = []
let installed = false

/**
 * Register a list of tiptap extensions to be appended to the admin's
 * built-in extension list. Idempotent — subsequent calls are ignored
 * so multiple `EditorBootstrap` renders (e.g. layout re-mounts)
 * don't replace the registry with a stale empty array.
 *
 * Calling with a list whose entries have duplicate `name` fields
 * (within the call) throws — same extension can't register twice.
 */
export function installAdminEditorExtensions(
  list: readonly TiptapExtensionLike[],
): void {
  if (installed) return
  const seen = new Set<string>()
  for (const ext of list) {
    const n = typeof ext.name === 'string' ? ext.name : ''
    if (!n) continue
    if (seen.has(n)) {
      throw new Error(
        `[ampless admin editor] duplicate tiptap extension name "${n}" in installAdminEditorExtensions(). Each extension may be registered at most once.`,
      )
    }
    seen.add(n)
  }
  extensions = list
  installed = true
}

/**
 * Read the currently installed extensions. <TiptapEditor> calls this
 * at render time and spreads the result onto its built-in extension
 * list. The list is intentionally readonly — consumers should not
 * mutate it in place.
 */
export function getAdminEditorExtensions(): readonly TiptapExtensionLike[] {
  return extensions
}
