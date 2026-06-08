---
"create-ampless": patch
---

Update `_shared` template scaffold for Phase 7 embed plugin extension:

- All theme post / home pages migrated from sync `<div dangerouslySetInnerHTML={{ __html: renderBody(post) }} />` to async `<div>{await ampless.renderBody(post)}</div>`, plus `{await ampless.publicPostScriptsForPage([post])}` after the body.
- New `_editor-bootstrap.tsx` scaffolds an empty `installAdminEditorExtensions([])` call site so users can drop in `@ampless/plugin-youtube/editor` and `@ampless/plugin-x-embed/editor` extensions.
- New `_actions/render-preview.tsx` server action renders draft posts into HTML for the admin's iframe preview.
- `admin/layout.tsx` wired with `editorBootstrap` slot.
- `admin/posts/[postId]/page.tsx` + `admin/posts/new/page.tsx` wired with `renderPreviewAction` factory option.

A `create-ampless upgrade` codemod for existing sites is intentionally deferred to a follow-up PR.
