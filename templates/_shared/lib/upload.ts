import { uploadData } from 'aws-amplify/storage'
import { processImage } from 'ampless/media'
import type { ProcessOptions } from 'ampless/media'
import { publicMediaUrl } from './media'

// Preserve Unicode (Japanese, emoji, etc.) — strip control chars and the
// characters S3 / URLs reject.
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
 * Run the image through processImage (crop/resize/encode) and upload the
 * result to S3 under `public/media/YYYY/MM/`. Returns a stable public URL.
 *
 * Used by both /admin/media (gallery uploads) and the editor's MediaPicker
 * (upload-and-embed) so the storage layout and naming stay consistent.
 */
export async function uploadProcessedImage(
  file: File,
  options: ProcessOptions
): Promise<{ path: string; url: string }> {
  const processed = await processImage(file, options)
  const safeName = sanitizeName(processed.suggestedName)
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const path = `public/media/${yyyy}/${mm}/${Date.now()}-${safeName}`
  await uploadData({
    path,
    data: processed.blob,
    options: { contentType: processed.mime },
  }).result
  return { path, url: publicMediaUrl(path) }
}
