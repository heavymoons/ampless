---
"@ampless/admin": minor
---

Client-side localStorage autosave + draft recovery for the post editor
(Phase C). Independent of the server-side revision history — explicit
saves still go to DynamoDB exactly as before; this is a per-browser
crash / accidental-close safety net that is never sent to the server.

- **Autosave**: the editor's in-progress state (title, slug, excerpt,
  format, body, status, tags, publish date, no-layout) is debounced
  (~1.2s) to `localStorage` under `ampless:draft:<postId|new>`. Writes
  only fire on a *genuine user edit*, not on open: `TiptapEditor` gains
  an `onUserEdit` callback fired solely from its `onUpdate` handler (not
  `onCreate`), so simply opening a post — which triggers tiptap's
  mount-time `onChange` and re-normalises stored JSON — writes no draft.
  Textarea/field edits, format switches, media inserts, and a revision
  restore all mark the form dirty too.

- **Recovery with base-version reconciliation**: on open, if a draft
  exists it is compared against the freshly-loaded post using the new
  `Post.updatedAt` anchor. Same base + differing content → offer to
  restore; server moved on since the draft was taken → a *stale* warning
  with Discard / Restore-anyway; draft equals loaded content → silently
  discarded. Accepting a tiptap recovery remounts the editor (it reads
  `content` only at init).

- **Clearing**: a successful explicit save clears this post's draft (and
  the shared `new` key on first create); signing out clears every
  `ampless:draft:*` key so unsaved edits don't linger on a shared browser.

- **Static posts are excluded** (their file bytes live in an in-memory
  bundle that can't be persisted); the editor shows a short note instead.

- `posts-provider` now maps DynamoDB's auto-managed `updatedAt` onto the
  `Post` it returns, so the editor receives the base version to reconcile
  against. New i18n keys under `posts.draft.*` in `en` / `ja`.
