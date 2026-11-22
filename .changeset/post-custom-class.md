---
"ampless": minor
"@ampless/runtime": minor
"@ampless/admin": minor
"@ampless/mcp-server": minor
"create-ampless": minor
"@ampless/backend": patch
---

Theme-declared custom classes for whole posts (heavymoons/ampless#380, phase 2; #402).

- `ampless`: `ThemeCustomClassTarget` is now `'table' | 'post'`. New helpers `themeCustomClasses(manifest, target)`, `themePostClasses`, `postCustomClassName` (`ampless-post--<id>`), `normalizePostClasses` and `postBodyClassName(metadata, base)`. `themeTableClasses` behaves as before. `PostMetadata` gains the reserved key `postClasses?: string[]`. Ids follow `CUSTOM_CLASS_ID_PATTERN`.
- `@ampless/runtime`: `ampless.postBodyClassName(post, base?)` returns `base` plus `ampless-post--<id>` for each id in `post.metadata.postClasses`. Ids are re-validated on every call, so values written via MCP / GraphQL cannot break out of the attribute. Posts without classes get `base` back unchanged, so their markup is byte-identical.
- `@ampless/admin`: the post settings gain a "Post styles" section with checkboxes for the active theme's `target: 'post'` classes. It shows when the theme declares post classes or the post already has some. It is hidden for static posts and `no_layout` html posts, which bypass the theme's post body wrapper; their stored selection is kept. Stored ids the active theme does not declare (for example after a theme switch) are kept, still rendered, flagged as "not declared by the active theme" and removable with one click. They are never dropped silently. Save writes `metadata.postClasses`, or removes the key when none are selected, and keeps the other metadata keys. Autosave drafts and revision restore include the selection. The preview request now sends the edited metadata, and the preview route adds the classes to its `<main>` wrapper. `createEditPostPage` / `createNewPostPage` read the theme manifest once for both table and post classes.
- `@ampless/mcp-server`: `create_post` and `update_post` accept a top-level `postClasses: string[]`. Invalid ids, at the top level or in `metadata.postClasses`, are rejected with an error that names them. `create_post` merges the list into `metadata`. `update_post` with `postClasses` and no `metadata` reads the current post and merges, so `cache`, `no_layout` and plugin keys are not erased. An empty array removes the key, and a missing post is an error. With both `metadata` and `postClasses`, the list is put into the supplied `metadata`, which still replaces the stored object as before. The tool descriptions and `get_schema` notes (`notes.postClasses`) document the key.
- `create-ampless`: all six stock themes pass `#post-body` through `ampless.postBodyClassName(post, '…')`, and the blog / corporate / dads / landing home pages do the same for the featured post body. `create-ampless upgrade` replaces stock themes, so they pick this up automatically.
- `@ampless/backend`: the schema comment lists the new reserved metadata key. There is no schema change.

To use post classes in a custom theme:

1. Declare them in the theme manifest: `customClasses: [{ id: 'wide', label: { en: 'Wide', ja: 'ワイド' }, description: '…', target: 'post' }]`.
2. Style them in the theme CSS, e.g. `.ampless-post--wide { … }` or `.ampless-post--wide h2 { … }`.
3. Change the post body wrapper's class to `className={ampless.postBodyClassName(post, '<the existing classes>')}`. Optionally do the same on the home page's featured-post wrapper, with `featured`.

`my-*` copies and other custom themes are not touched by `upgrade` and need the one-line edit in step 3. Without it, editors can pick post styles and they are stored, but the theme does not render them.

Ids stay in the post when the active theme stops declaring them. They keep rendering as `ampless-post--<id>`, which is unstyled until a theme declares that id again.
