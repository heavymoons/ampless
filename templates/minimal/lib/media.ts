import outputs from '../amplify_outputs.json'
import cmsConfig from '../cms.config'

interface StorageOutput {
  bucket_name: string
  aws_region: string
}

const storage = (outputs as { storage?: StorageOutput }).storage

function s3DirectUrl(path: string): string {
  if (!storage) return `/api/media/${path}` // sandbox not deployed yet
  return `https://${storage.bucket_name}.s3.${storage.aws_region}.amazonaws.com/public/${path}`
}

// Returns a stable URL the browser can use to display an uploaded media file.
//
// Resolves based on `cms.config.ts` `media.delivery`:
//   - `nextjs`     (default): proxy via `/api/media/...` → Next.js issues a
//                  short-lived S3 presigned URL using server credentials.
//                  Keeps URLs permanent without making the bucket public.
//   - `s3-direct`: build the direct `https://{bucket}.s3.{region}.amazonaws.com/public/...`
//                  URL. Requires the storage bucket policy in
//                  `amplify/backend.ts` to be active so anonymous GETs work.
//
// Inputs accepted:
//   - "public/media/2026/04/foo.jpg" (S3 path)
//   - "media/2026/04/foo.jpg" (path relative to public/)
//   - "https://..." (passthrough)
export function publicMediaUrl(input: string): string {
  if (/^https?:\/\//.test(input)) return input
  let path = input.replace(/^\/+/, '')
  if (path.startsWith('public/')) path = path.slice('public/'.length)

  const delivery = cmsConfig.media?.delivery ?? 'nextjs'
  return delivery === 's3-direct' ? s3DirectUrl(path) : `/api/media/${path}`
}
