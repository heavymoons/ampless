/**
 * Filename / S3 key helpers shared between the stdio CLI's S3 client
 * (`src/s3.ts`) and the `upload_media` tool handler. Kept in this file
 * (instead of inside `s3.ts`) so the tools sub-export doesn't pull
 * `@aws-sdk/client-s3` into consumers that supply their own storage
 * adapter (e.g. `@ampless/admin/api/mcp`).
 */

/**
 * Preserve Unicode (Japanese, emoji, etc.) while stripping control
 * chars and characters S3 / URLs handle badly. Mirrors
 * `templates/_shared/lib/upload.ts:sanitizeName`.
 */
export function sanitizeName(name: string): string {
  return (
    name
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f]/g, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^\.+/, '_')
      .slice(0, 200) || 'upload'
  )
}

/**
 * Build the canonical S3 key for an uploaded media file. Layout is
 * `public/media/{YYYY}/{MM}/{epochMs}-{sanitizedName}` — month-bucketed
 * so a single year doesn't accumulate millions of objects in one
 * prefix, with the epoch timestamp first so multi-upload collisions
 * fall on different sort keys.
 */
export function buildMediaKey(filename: string, now: Date = new Date()): string {
  const safe = sanitizeName(filename)
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  return `public/media/${yyyy}/${mm}/${now.getTime()}-${safe}`
}
