// `@ampless/admin/editor` — public subpath for first-party plugins
// that ship a tiptap extension. Plugins import
// `installAdminEditorExtensions` (or read back with
// `getAdminEditorExtensions`) and the admin's <TiptapEditor> picks up
// every registered extension at the end of its built-in list.
//
// The internal module lives at `src/editor/admin-editor-extensions.ts`
// so tsup's `entry: ['src/editor.ts']` emits `dist/editor.js` matching
// the `exports#./editor` mapping in package.json.
export {
  installAdminEditorExtensions,
  getAdminEditorExtensions,
  type TiptapExtensionLike,
} from './editor/admin-editor-extensions.js'
