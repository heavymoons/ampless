---
"ampless": minor
"@ampless/mcp-server": minor
"@ampless/admin": patch
"@ampless/backend": minor
"create-ampless": patch
---

MCP static-format post support (4 new tools).

`upload_static_bundle` (zip-based, one-shot), `upload_static_file` /
`delete_static_file` (incremental per-file ops), `commit_static_post`
(rebuild the Post manifest from the current S3 prefix).

Refactor: `mimeTypeFor`, `validateBundlePath`, `findAbsolutePathRefs`,
`validateBundle`, `bundlePrefix`, `pickDefaultEntrypoint`,
`stripCommonPrefix` moved from `@ampless/admin/lib/static-bundle` to
`ampless` core so the MCP tool registry can reuse the validation.
Admin re-exports the moved helpers, no behaviour change for the
existing browser uploader.

StorageClient interface (`@ampless/mcp-server/tools`) gains
`deleteObject` and `listObjects`, implemented with the new AWS SDK
commands (`DeleteObjectCommand`, `ListObjectsV2Command`).

IAM: mcp-handler Lambda role gets `s3:PutObject` / `s3:DeleteObject`
on `public/static/*` and `s3:ListBucket` with a prefix condition for
the same path.

`format: 'static'` is intentionally NOT added to the generic
`create_post` / `update_post` enums. The bundle tools are the only
supported entry point; mixing generic post mutations would let
callers create posts whose `body` manifest doesn't match the S3
prefix.

Deferred:
- Page model static support (Post-only for now)
- `delete_static_post` cleanup tool
- Per-file uploads larger than the Lambda payload cap (~4 MB binary
  after base64). Use `upload_static_bundle` for whole-bundle workflows
  that fit, or the admin StaticUploader for anything over ~5 MB.
