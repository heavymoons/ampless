import type { Config } from 'ampless'
import type { AmplessOutputs } from '@ampless/runtime'

interface StorageOutputShape {
  bucket_name: string
  aws_region: string
}

interface AdminMediaState {
  outputs: AmplessOutputs | null
  cmsConfig: Config | null
}

const state: AdminMediaState = { outputs: null, cmsConfig: null }

/**
 * Register the project's outputs + cms.config for client-side media
 * URL resolution. Called once from the admin layout factory so client
 * components downstream can call `publicMediaUrl` without threading
 * the config through props.
 */
export function setAdminMediaContext(
  outputs: AmplessOutputs,
  cmsConfig: Config
): void {
  state.outputs = outputs
  state.cmsConfig = cmsConfig
}

/**
 * Standalone `publicMediaUrl` callable from client components. Reads
 * from the module-level state registered by `setAdminMediaContext`.
 *
 * Resolves based on `cms.config.ts` `media.delivery`:
 *   - `nextjs`     (default): proxy via `/api/media/...` → Next.js issues a
 *                  short-lived S3 presigned URL using server credentials.
 *                  Keeps URLs permanent without making the bucket public.
 *   - `s3-direct`: build the direct `https://{bucket}.s3.{region}.amazonaws.com/public/...`
 *                  URL. Requires the storage bucket policy in
 *                  `amplify/backend.ts` to be active so anonymous GETs work.
 *
 * Inputs accepted:
 *   - "public/media/2026/04/foo.jpg" (S3 path)
 *   - "media/2026/04/foo.jpg" (path relative to public/)
 *   - "https://..." (passthrough)
 */
export function publicMediaUrl(input: string): string {
  if (/^https?:\/\//.test(input)) return input
  let path = input.replace(/^\/+/, '')
  if (path.startsWith('public/')) path = path.slice('public/'.length)

  const { outputs, cmsConfig } = state
  const delivery = cmsConfig?.media?.delivery ?? 'nextjs'
  if (delivery !== 's3-direct') return `/api/media/${path}`

  const storage = (outputs as { storage?: StorageOutputShape } | null)?.storage
  if (!storage) return `/api/media/${path}`
  return `https://${storage.bucket_name}.s3.${storage.aws_region}.amazonaws.com/public/${path}`
}

/**
 * Server-side factory mirroring the same logic. Bound up front so admin
 * callers (e.g. createAdmin) get a `publicMediaUrl` they can pass into
 * UI props or use from server components.
 */
export function createMedia(outputs: AmplessOutputs, cmsConfig: Config) {
  const storage = (outputs as { storage?: StorageOutputShape }).storage

  function s3DirectUrl(path: string): string {
    if (!storage) return `/api/media/${path}` // sandbox not deployed yet
    return `https://${storage.bucket_name}.s3.${storage.aws_region}.amazonaws.com/public/${path}`
  }

  function urlFor(input: string): string {
    if (/^https?:\/\//.test(input)) return input
    let path = input.replace(/^\/+/, '')
    if (path.startsWith('public/')) path = path.slice('public/'.length)

    const delivery = cmsConfig.media?.delivery ?? 'nextjs'
    return delivery === 's3-direct' ? s3DirectUrl(path) : `/api/media/${path}`
  }

  return { publicMediaUrl: urlFor }
}
