// `@ampless/admin/editor` — public subpath for first-party plugins
// that ship a tiptap extension. Plugins import
// `installAdminEditorExtensions` (or read back with
// `getAdminEditorExtensions`) and the admin's <TiptapEditor> picks up
// every registered extension at the end of its built-in list.
//
// Also exports `installAdminTiptapNodeMarkdown` /
// `getAdminTiptapNodeMarkdown` for the tiptap → markdown lossless
// serialisation registry, and `installAdminTiptapNodeHtml` /
// `getAdminTiptapNodeHtml` for the tiptap → html lossless serialisation
// registry. The codegen'd `_editor-bootstrap.tsx` calls both installs
// with the adapters exported by each plugin's `./editor` module so the
// admin's format-switch can round-trip embed nodes.
//
// The internal modules live at `src/editor/admin-*.ts` so tsup's
// `entry: ['src/editor.ts']` emits `dist/editor.js` matching the
// `exports#./editor` mapping in package.json.
export {
  installAdminEditorExtensions,
  getAdminEditorExtensions,
  type TiptapExtensionLike,
} from './editor/admin-editor-extensions.js'
export {
  installAdminTiptapNodeMarkdown,
  getAdminTiptapNodeMarkdown,
} from './editor/admin-node-markdown.js'
export {
  installAdminTiptapNodeHtml,
  getAdminTiptapNodeHtml,
} from './editor/admin-node-html.js'
