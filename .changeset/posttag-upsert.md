---
"@ampless/admin": patch
---

Fix "The conditional request failed" DynamoDB error when saving a post whose `PostTag` rows were missing from DynamoDB.

Symptom (from the dogfood site, ishinao.net): post-003 was status='published' with no PostTag rows written. Editing the post made `syncPostTags` compute the "update existing" branch from `oldPost.tags`, but AppSync's `update` mutation requires `attribute_exists(<PK>)` — and those rows weren't in DDB. Save failed with:

```
The conditional request failed (Service: DynamoDb, Status Code: 400, ...)
```

Make `syncPostTags` idempotent by switching both branches to upsert:

- **New entries** (key only in newKeys): try `create` first; on conditional failure (orphan row left over from previous unclean delete) fall back to `update`.
- **Existing entries** (key in both): try `update` first; on conditional failure (row never created) fall back to `create`.

Existing entries that no longer apply (delete branch) stay unchanged — `delete` is naturally idempotent.
