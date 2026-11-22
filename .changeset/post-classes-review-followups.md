---
"ampless": minor
"@ampless/admin": patch
"create-ampless": patch
---

Follow-ups to the theme post classes release (heavymoons/ampless#408).

- `ampless`: new `mergePostMetadata(base, mine, theirs)`, a three-way merge of post metadata per top-level key (a key the editor left unchanged takes the stored value, a changed key takes the editor's value or its removal). `updatePost(postId, data, options?)` accepts `{ expectedUpdatedAt }` and forwards it to the provider as a compare-and-swap on the stored `updatedAt` (`null` = no `updatedAt` yet); a mismatch throws the new exported `PostUpdateConflictError`. Backward compatible: the third argument of `PostsProvider.update` is optional, so existing custom providers still type-check, and `updatePost` without options calls them exactly as before. A provider that ignores the option writes unconditionally.
- `@ampless/admin`: saving an existing post no longer overwrites metadata that changed after the form was opened (for example `postClasses` set by MCP `update_post`, or a plugin key). The form re-reads the post, merges metadata three ways and writes conditionally on the re-read `updatedAt`. If the post changes in between, nothing is written, the edits stay in the form and a "save again" message is shown. Other fields stay last-write-wins, as before; creating a post is unchanged. The admin posts provider implements `expectedUpdatedAt` with a conditional `updatePost` mutation; without it the write path is unchanged.
- `@ampless/admin`: restoring a revision applies post styles only when both the revision's and the current `metadata.postClasses` are absent or a clean id list. Otherwise the current stored value (for example a plugin-owned one) is kept and a notice explains why, so restoring a legacy non-array or string value can no longer erase it on save.
- `@ampless/admin`: the preview copies every http(s) stylesheet link of the admin page again, CDN-hosted ones included (as before the post classes release), keeping `integrity`, `crossorigin`, `media` and `referrerpolicy`. Other schemes are skipped. These are stylesheets the admin page already loaded, so no new origin is introduced and the CSP is unchanged.
- `create-ampless`: the bundled `THEMES.md` / `THEMES.ja.md` describe the preview's stylesheets accordingly.
