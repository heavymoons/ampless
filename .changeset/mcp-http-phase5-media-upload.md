---
"@ampless/backend": minor
---

v0.2 MCP HTTP transport — Phase 5 (media upload).

`upload_media` is now reachable over HTTP. The Lambda decodes the
base64 body from the tool call params, uploads bytes to S3 under
`public/media/{YYYY}/{MM}/{epochMs}-{filename}`, and creates the
Media row through the same AppSync IAM auth path that the post CRUD
tools use.

Implementation choice: inline base64, matching the stdio CLI. Keeps
the tool surface uniform (LLM clients call `upload_media` with the
same args regardless of transport) and stays within the MCP protocol
without a side-channel HTTP PUT step. Trade-off: limited by the
Lambda synchronous payload cap (~6 MB after JSON envelope = ~4 MB of
binary). Typical CMS image uploads fit; video or large files should
use the stdio CLI until v0.3 introduces a presigned-PUT flow.

Backend wiring:
- mcp-handler Lambda gains `s3:PutObject` on the storage bucket's
  `public/media/*` prefix (matches what `buildMediaKey` produces).
- New `AMPLESS_BUCKET_NAME` env var (read at handler cold start).
- The `tools/list` registry no longer filters out `upload_media`;
  the handler's storage thunk returns a real `S3Client`-backed
  putObject instead of the Phase 4 "not implemented" stub.
