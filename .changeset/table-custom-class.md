---
"ampless": minor
"@ampless/runtime": minor
"@ampless/admin": minor
---

Theme-declared custom classes for tables (heavymoons/ampless#380, phase 1).

- `ampless`: `ThemeManifest.customClasses` (optional) declares classes a theme styles, e.g. `{ id: 'compact', label: 'Compact', target: 'table' }`. New helpers `isValidCustomClassId`, `tableCustomClassName`, `themeTableClasses`, and `CUSTOM_CLASS_ID_PATTERN` (`/^[a-z0-9-]+$/`, max 64 chars).
- `@ampless/runtime`: a tiptap `table` node with `attrs.customClass` renders as `class="tiptap-table tiptap-table--<id>"` in both the React walker (`renderBody`) and the string walker (`tiptapToHtml`). The id is re-validated on every render and anything invalid is dropped, so values written via MCP / GraphQL cannot break out of the attribute. Tables without the attribute render byte-identical markup. Markdown output (`tiptapToMarkdown`, `/md`) cannot represent the class and omits it.
- `@ampless/admin`: the editor's table extension keeps `customClass` through load / save, renders it, and parses `tiptap-table--<id>` back from HTML (tiptap → html → tiptap format switches and pasted tables keep it). The table toolbar menu gains a "Table style" section listing the active theme's table classes; the trigger shows the active style. An id the active theme does not declare (for example after a theme switch) is kept, still rendered, and flagged in the menu instead of being dropped. `createEditPostPage` / `createNewPostPage` now use the `admin` argument the templates already pass to load the active theme (no template change needed); if the theme cannot be loaded the editor offers no styles and logs the error.

Themes opt in by declaring `customClasses` in their manifest and styling `.tiptap-table--<id>` in their own CSS. Switching a post to markdown drops table classes (GFM tables have no class).
