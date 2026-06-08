---
"@ampless/admin": minor
---

Add new `@ampless/admin/editor` subpath (`installAdminEditorExtensions` / `getAdminEditorExtensions`) so first-party embed plugins (`@ampless/plugin-youtube`, `@ampless/plugin-x-embed`) can hand tiptap Node extensions to the admin editor. New `createAdminLayout(admin, { editorBootstrap })` slot wraps every admin route in the template-supplied bootstrap component.

`<PostForm>` / `<PostHistoryPanel>` now accept a `renderPreviewAction?: (draft: Post) => Promise<string>` prop. The preview pane renders through an `<iframe srcDoc>` (sandbox=`allow-scripts` only) populated by the template's `'use server'` action — the previous inline `renderBody` call was no longer possible after the runtime change.

Page factories `createEditPostPage(admin)` / `createNewPostPage(admin)` accept a new `opts.renderPreviewAction` option that threads down to the form.

New `Admin.getAmpless(): Promise<Ampless>` exposes the internal resolved-runtime cache so template-side server actions can use the same instance as the rest of admin.

**Alpha breaking** (admin UI behaviour): without `renderPreviewAction`, the preview pane shows a fallback message instead of rendering. Templates need to wire the action via the page factory option.
