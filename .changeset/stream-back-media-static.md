---
"ampless": minor
"@ampless/admin": minor
"@ampless/backend": minor
"@ampless/runtime": minor
"@ampless/mcp-server": minor
---

Stream S3 assets back through the Lambda response instead of 302-redirecting to a presigned URL. Repeat reads of `/api/media/...` and static-bundle `/<slug>/<path>` now hit Amplify CloudFront's edge cache instead of round-tripping to S3 each time. Files larger than 6 MB still fall back to the 302 presigned path so the response stays under the Lambda buffered-response cap.

Asset metadata (size, mimeType, etag) is persisted in the Media DynamoDB row (`metadata` JSON column added) and, for static bundles, in `post.metadata.files`. A new public-keyed `getMediaBySrc(src)` custom query targets a `bySrc` GSI on the Media model so the media-proxy route reads the persisted row directly and skips the HEAD round-trip on warm reads. Both the browser admin uploads (`/admin/media` gallery + the editor's image picker) and the MCP `upload_media` tool create a Media row on every successful upload, recording the S3 PutObject ETag on `Media.metadata.etag`. Orphan / legacy uploads without a Media row gracefully fall back to an Amplify SSR HEAD memoised in a per-Lambda LRU (1000 entries, 5 minute TTL).

Schema additions: `Media.metadata: a.json()`, `Media.secondaryIndexes(i => [i('src').name('bySrc')])`, `PublicMedia` custom type (narrow projection), `getMediaBySrc` custom query with `allow.publicApiKey()`. The new JS resolver lives at `templates/_shared/amplify/data/get-media-by-src.js`. `StorageClient.putObject` returns `{ url, etag }` instead of a plain URL string. `PostMetadata.files: Record<string, { size, mimeType }>` is a new well-known key consumed by the static delivery route.

Browser-side `uploadBundle` now returns `{ body, filesMeta }` instead of just the manifest; callers thread `filesMeta` into `post.metadata.files` on save. `post-form.tsx` does this automatically. `uploadProcessedImage` and `MediaUploader` now write a Media DynamoDB row alongside the S3 upload (errors logged but non-fatal — the file is already in S3 and usable).

New helpers exported from `@ampless/runtime`: `streamS3Object`, `createMediaApi`, `Ampless.getMediaBySrc`. New helper exported from `@ampless/admin`: `Admin.getMediaBySrc` (resolves through the Ampless runtime instance).
