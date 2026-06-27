---
"@ampless/mcp-server": patch
---

Fix `delete_media` by `src`, and validate `upload_media` MIME types.

- `delete_media` with only `src` could not delete the Media row: it resolved `mediaId` through the public `getMediaBySrc` query, whose `PublicMedia` projection intentionally omits `mediaId`, so the row delete never ran (the S3 object was removed but the DynamoDB row was orphaned). It now resolves `src → mediaId` against the `Media` model via `listMedia` (filtered by the unique `src`, paged) so both the object and the row are removed.
- `upload_media` now validates `mimeType`: it must match a basic IANA `type/subtype` shape (length-capped) and active-content types (`text/html`, `application/javascript`, etc.) are rejected, since the media bucket is served publicly and such objects could be abused for phishing/XSS.
