---
"@ampless/admin": minor
"ampless": minor
---

Admin revision-history UI for posts (Phase B).

The post editor now has a collapsible **Revision history** panel (edit mode
only). It lists each saved snapshot newest-first — revised time (in the
project's configured timezone/locale), status, and title — with cursor-based
"load more" pagination over the `PostHistory` `byPost` GSI (history is
unbounded by default, so it never assumes one page). You can **view** any
revision read-only (rendered with the same renderer the preview uses) and
**restore** one into the editor for review before saving.

Restore pours only the content fields back into the form — `title`, `slug`,
`excerpt`, `format`, `body`, `status`, `tags`, `publishedAt` — plus the
`no_layout` flag (honoured only for `html` revisions, matching the form's
`buildMetadata` gating). The full `metadata` blob is intentionally **not**
applied on restore so it can't clobber plugin/SEO state; the snapshot still
stores it. Restoring a tiptap revision remounts the editor (it reads
`content` only at init). Static revisions surface a caveat: only the manifest
is restored — the referenced S3 bundle may have been overwritten by a later
save.

`ampless` gains the public `listPostHistory(postId, options?)` reader plus the
`PostRevision`, `ListPostHistoryOptions`, and `PostRevisionConnection` types,
and a corresponding `listPostHistory` method on the `PostsProvider` interface.
(Pre-1.0: the new required provider method is a breaking change for any
external `PostsProvider` implementer — bumped `minor` per policy.)
