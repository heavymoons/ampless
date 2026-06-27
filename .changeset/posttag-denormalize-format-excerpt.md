---
"ampless": minor
"@ampless/backend": patch
---

Denormalize `format` (and `excerpt`) onto the PostTag index so tag-page listings show the real format.

The `listPostsByTag` resolver previously hard-coded `format: 'markdown'` because the PostTag row didn't carry a format, so the public tag-list API mislabeled every non-markdown (html / tiptap / static) post. Fixed end-to-end:

- **ampless**: `ContentEventPayload` gains optional `format` / `excerpt` fields (additive) so the `post.index.refresh` event carries them.
- **backend**: the stream dispatcher now projects `format` / `excerpt` into the event payload, the trusted processor's `posttag-sync` writes them onto each PostTag row (omitting absent values so the direct DynamoDB put never sees `undefined`), and the `PostTag` model gains a `format` column.

Note: the new `PostTag.format` column is a schema change — existing PostTag rows backfill the field on the next mutation of each post (the index is rebuilt on every create/update/delete); rows written before the upgrade fall back to the runtime's documented `?? 'markdown'` default until then.
