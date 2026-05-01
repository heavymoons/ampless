import Link from 'next/link'
import { siteFor } from 'ampless'
import cmsConfig from '@/cms.config'
import { loadSiteSettings } from '@/lib/site-settings'
import {
  SiteSettingsForm,
  type SiteSettingsFormValues,
} from '@/components/admin/site-settings-form'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ siteId: string }>
}

// Server-rendered: pre-fills the form with the merged settings (so the
// editor sees what's currently effective). The form itself writes
// directly to KvStore via the AppSync client; no Server Action needed.
export default async function EditSitePage({ params }: Props) {
  const { siteId } = await params
  const settings = await loadSiteSettings(siteId)

  const defaults = siteFor(siteId, cmsConfig)
  const fallback: SiteSettingsFormValues = {
    'site.name': defaults.name,
    'site.url': defaults.url,
    'site.description': defaults.description,
    'media.imageDisplay': cmsConfig.media?.imageDisplay,
    'media.imageMaxWidth': cmsConfig.media?.imageMaxWidth,
    dateFormat: cmsConfig.dateFormat,
    timezone: cmsConfig.timezone,
  }

  const initial: SiteSettingsFormValues = {
    'site.name': settings.site.name,
    'site.url': settings.site.url,
    'site.description': settings.site.description,
    'media.imageDisplay': settings.media.imageDisplay,
    'media.imageMaxWidth': settings.media.imageMaxWidth,
    dateFormat: settings.dateFormat,
    timezone: settings.timezone,
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <Link
          href="/admin/sites"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Sites
        </Link>
        <h1 className="mt-2 text-3xl font-bold">{settings.site.name}</h1>
        <p className="text-sm text-muted-foreground">
          siteId: <code className="font-mono">{siteId}</code>
        </p>
        <div className="mt-4">
          <Link
            href={`/admin/sites/${siteId}/theme`}
            className="text-sm font-medium underline"
          >
            Theme settings →
          </Link>
        </div>
      </div>

      <SiteSettingsForm siteId={siteId} initial={initial} fallback={fallback} />
    </div>
  )
}
