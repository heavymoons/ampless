// Returns a stable URL that the browser can use to display an uploaded
// media file. Internally a Next.js API route (/api/media/...) issues a
// short-lived S3 presigned URL using server credentials, so the URL we
// store in posts never expires.
//
// Inputs:
//   - "public/media/2026/04/foo.jpg" (S3 path)
//   - "media/2026/04/foo.jpg" (path relative to public/)
//   - "https://..." (passthrough)
export function publicMediaUrl(input: string): string {
  if (/^https?:\/\//.test(input)) return input
  let path = input.replace(/^\/+/, '')
  if (path.startsWith('public/')) path = path.slice('public/'.length)
  return `/api/media/${path}`
}
