import { DEFAULT_SITE_ID, unflattenSettings, type Config } from 'ampless'
import type { StorageApi } from './storage.js'

// Merged effective settings for the site. Shape mirrors `cms.config.ts`
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

export interface SiteSettingsApi {
  /**
   * `siteId` is accepted for API compatibility but ignored — ampless
   * runs one site per Amplify deployment, so settings always resolve
   * against the single `DEFAULT_SITE_ID` partition.
   */
  loadSiteSettings(siteId?: string): Promise<EffectiveSiteSettings>
}

export function createSiteSettings(
  cmsConfig: Config,
  storage: StorageApi
): SiteSettingsApi {
  async function fetchRemote(): Promise<RemoteSettings | null> {
    if (!storage.isStorageConfigured()) return null
    let url: string
    try {
      url = storage.publicAssetUrl(`public/site-settings/${DEFAULT_SITE_ID}.json`)
    } catch {
      return null
    }
    // Next.js dedupes & caches GETs across the request when `revalidate`
    // is set. 60s matches the S3 cache header from the trusted processor,
    // so admin edits propagate within ~1 minute on cold pages.
    const res = await fetch(url, {
      next: { revalidate: 60, tags: [`site-settings:${DEFAULT_SITE_ID}`] },
    })
    if (!res.ok) return null
    const flat = (await res.json()) as Record<string, unknown>
    return unflattenSettings(flat) as RemoteSettings
  }

  /**
   * Resolve the effective settings by merging:
   *   1. KvStore-backed runtime settings (S3 cache)
   *   2. cms.config defaults (site, media, dateFormat, timezone)
   *
   * Runtime always wins when present.
   */
  return {
    async loadSiteSettings(): Promise<EffectiveSiteSettings> {
      const remote = await fetchRemote().catch(() => null)
      const baseSite = cmsConfig.site

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
    },
  }
}
