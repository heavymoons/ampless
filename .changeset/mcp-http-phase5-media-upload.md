---
"@ampless/backend": minor
---

MCP HTTP transport — Phase 5 (media upload).

`upload_media` is now reachable over HTTP. The Lambda decodes the
base64 body from the tool call params, uploads bytes to S3 under
`public/media/{YYYY}/{MM}/{epochMs}-{filename}`, and creates the
Media row through the AppSync IAM auth path.

Implementation: inline base64, keeping the tool surface uniform
(LLM clients call `upload_media` with the same args regardless of
transport). Limited by the Lambda synchronous payload cap (~6 MB
after JSON envelope = ~4 MB of binary). Typical CMS image uploads
fit; video or large files should use the admin uploader until a
presigned-PUT flow is introduced.

Backend wiring:
- mcp-handler Lambda gains `s3:PutObject` on the storage bucket's
  `public/media/*` prefix (matches what `buildMediaKey` produces).
- New `AMPLESS_BUCKET_NAME` env var (read at handler cold start).
- The `tools/list` registry exposes `upload_media` with a real
  `S3Client`-backed putObject.
