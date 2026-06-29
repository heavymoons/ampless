---
"@ampless/backend": minor
---

Tighten model field constraints to match the TypeScript types.

- `Post.format` / `Post.status` and `Page.format` / `Page.status` are now `.required()` (they were nullable `a.enum(...)` despite being non-optional on the `Post` / `Page` interfaces in `ampless/types.ts`).
- `Media.delivery` is now `a.enum(['nextjs', 's3-direct']).required()` (was a bare nullable `a.string()`).

These match what every write path already sets (`create_post` / `update_post`, `upload_media`, and the admin form all populate format / status / delivery). `PostTag.format` and `PostHistory.*` are intentionally left optional — the denormalized tag index and historical snapshots may legitimately omit them.

Migration note: Amplify's AppSync read resolver returns `null` for the **entire row** if a now-required field is absent, so existing DynamoDB rows must already carry `format` / `status` / `delivery`. Rows created through ampless always do (verified against a production deployment); if you have rows written by other means, backfill those attributes before deploying this change.
