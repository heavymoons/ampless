---
"ampless": minor
---

Add `HistoryConfig` type and `Config.history?: HistoryConfig`.

`history.retentionDays` controls how long the event-dispatcher's `PostHistory`
revision snapshots are retained before DynamoDB TTL deletes them. Default `0`
keeps every revision forever (no `ttl` attribute written). `HistoryConfig` is
re-exported from the package entry alongside `Config` / `CacheConfig`.
