---
"ampless": patch
"@ampless/backend": patch
---

Harden two trusted-side runtime boundaries:

- `validatePublicAssetKey` now requires the key to match `[A-Za-z0-9._/-]+`. URL-reserved characters (`#`, `?`, `&`, `=`, `+`, space, etc.) and non-ASCII bytes survive an S3 PutObject but make the returned public URL parse to a different object than the actual S3 key — restricting the alphabet keeps the S3 path and the URL the same string.
- The trusted processor now validates `plugin.instanceId ?? plugin.name` against `PLUGIN_KEY_PATTERN` (`/^[a-zA-Z0-9_-]+$/`) at handler init and skips any plugin whose namespace would escape the per-plugin prefix. Previously `instanceId: '../foo'` or `'bad/id'` would have been spliced straight into the S3 key.
