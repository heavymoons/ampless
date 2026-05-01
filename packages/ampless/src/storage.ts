// Storage URL helpers shared between Lambda code (processor-trusted) and
// Next.js route handlers (sitemap.xml, feed.xml).

/**
 * Build the public S3 URL for an object key, in the regional virtual-host
 * style: `https://{bucket}.s3.{region}.amazonaws.com/{key}`. The legacy
 * non-regional form (`s3.amazonaws.com`) issues redirects and is avoided.
 */
export function formatPublicAssetUrl(
  bucket: string,
  region: string,
  key: string
): string {
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`
}
