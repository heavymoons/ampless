import { DEFAULT_SITE_ID, siteFor, unflattenSettings } from 'ampless'
import cmsConfig from '@/cms.config'
import { publicAssetUrl, isStorageConfigured } from './storage'

// Merged effective settings for a site. Shape mirrors `cms.config.ts`
// but only includes the runtime-overridable subset.
export interface EffectiveSiteSettings {
  site: { name: string; url: string; description?: string }
  media: {
    imageDisplay?: 'inline' | 'lightbox'
    imageMaxWidth?: string
    processing?: {
      maxDimension?: number
      format?: 'webp' | 'jpeg' | 'original'
      quality?: number
      losslessForPng?: boolean
    }
  }
  dateFormat?: 'iso' | 'long' | 'locale'
  timezone?: string
}

interface RemoteSettings {
  site?: Partial<EffectiveSiteSettings['site']>
  media?: Partial<EffectiveSiteSettings['media']>
  dateFormat?: EffectiveSiteSettings['dateFormat']
  timezone?: EffectiveSiteSettings['timezone']
}

async function fetchRemote(siteId: string): Promise<RemoteSettings | null> {
  if (!isStorageConfigured()) return null
  let url: string
  try {
    url = publicAssetUrl(`public/site-settings/${siteId}.json`)
  } catch {
    return null
  }
  // Next.js dedupes & caches GETs across the request when `revalidate`
  // is set. 60s matches the S3 cache header from the trusted processor,
  // so admin edits propagate within ~1 minute on cold pages.
  const res = await fetch(url, { next: { revalidate: 60, tags: [`site-settings:${siteId}`] } })
  if (!res.ok) return null
  const flat = (await res.json()) as Record<string, unknown>
  return unflattenSettings(flat) as RemoteSettings
}

/**
 * Resolve the effective settings for a site by merging:
 *   1. KvStore-backed runtime settings (S3 cache)
 *   2. cms.config.sites.{siteId} per-site overrides
 *   3. cms.config defaults (site, media, dateFormat, timezone)
 *
 * Higher-numbered layers fill in missing fields only — runtime always
 * wins when present.
 */
export async function loadSiteSettings(
  siteId: string = DEFAULT_SITE_ID
): Promise<EffectiveSiteSettings> {
  const remote = await fetchRemote(siteId).catch(() => null)
  const baseSite = siteFor(siteId, cmsConfig)

  return {
    site: {
      name: remote?.site?.name ?? baseSite.name,
      url: remote?.site?.url ?? baseSite.url,
      description: remote?.site?.description ?? baseSite.description,
    },
    media: {
      imageDisplay: remote?.media?.imageDisplay ?? cmsConfig.media?.imageDisplay,
      imageMaxWidth: remote?.media?.imageMaxWidth ?? cmsConfig.media?.imageMaxWidth,
      processing: {
        maxDimension:
          remote?.media?.processing?.maxDimension ?? cmsConfig.media?.processing?.maxDimension,
        format: remote?.media?.processing?.format ?? cmsConfig.media?.processing?.format,
        quality: remote?.media?.processing?.quality ?? cmsConfig.media?.processing?.quality,
        losslessForPng:
          remote?.media?.processing?.losslessForPng ??
          cmsConfig.media?.processing?.losslessForPng,
      },
    },
    dateFormat: remote?.dateFormat ?? cmsConfig.dateFormat,
    timezone: remote?.timezone ?? cmsConfig.timezone,
  }
}
