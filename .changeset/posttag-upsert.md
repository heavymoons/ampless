---
"@ampless/admin": patch
---

Fix "The conditional request failed" DynamoDB error when saving a post that was published before the `PostTag` denormalized index existed.

Symptom (from the dogfood site, ishinao.net): post-003 was status='published' since before the PostTag index was introduced, so no PostTag rows were ever written. Editing the post (e.g. changing `format` from markdown to tiptap) made `syncPostTags` compute the "update existing" branch from `oldPost.tags`, but AppSync's `update` mutation requires `attribute_exists(<PK>)` — and those rows weren't in DDB. Save failed with:

```
The conditional request failed (Service: DynamoDb, Status Code: 400, ...)
```

Make `syncPostTags` idempotent by switching both branches to upsert:

- **New entries** (key only in newKeys): try `create` first; on conditional failure (orphan row left over from previous unclean delete) fall back to `update`.
- **Existing entries** (key in both): try `update` first; on conditional failure (legacy post, row never created) fall back to `create`.

Existing entries that no longer apply (delete branch) stay unchanged — `delete` is naturally idempotent.

After this fix, legacy posts that were published before PostTag existed get their PostTag rows created automatically on first save.
