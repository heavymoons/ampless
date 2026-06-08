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
 * Structural type for a tiptap extension instance. The admin can't
 * import `@tiptap/core` here (the package is a peerDep of admin and
 * not all consumers have it installed), so we accept anything with a
 * `name` string and pass it through to <TiptapEditor>'s
 * `useEditor({ extensions: [...] })` array spread.
 */
export interface TiptapExtensionLike {
  readonly name?: string
  // Tiptap extensions carry arbitrary additional fields — `unknown`
  // here is intentional. The admin doesn't inspect them.
  readonly [key: string]: unknown
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
