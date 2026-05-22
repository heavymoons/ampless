import Link from 'next/link'
import type { Admin } from '../index.js'
import {
  SiteSettingsForm,
  type SiteSettingsFormValues,
} from '../components/site-settings-form.js'

interface Props {
  params: Promise<{ siteId: string }>
}

/**
 * Server-rendered: pre-fills the form with the merged settings (so the
 * editor sees what's currently effective). The form itself writes
 * directly to KvStore via the AppSync client; no Server Action needed.
 *
 * ampless runs one site per Amplify deployment. The route still takes a
 * `[siteId]` param for forward-compat with the existing URL structure,
 * but the value isn't used — a follow-up PR flattens the URL.
 */
export function createSiteEditPage(admin: Admin) {
  const { cmsConfig, t, loadSiteSettings } = admin

  async function EditSitePage({ params }: Props) {
    const { siteId } = await params
    const settings = await loadSiteSettings()

    const fallback: SiteSettingsFormValues = {
      'site.name': cmsConfig.site.name,
      'site.url': cmsConfig.site.url,
      'site.description': cmsConfig.site.description,
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
      <div className="mx-auto max-w-7xl p-4 md:p-8">
        <div className="mb-6 md:mb-8">
          <h1 className="mt-2 text-2xl font-bold md:text-3xl">{settings.site.name}</h1>
          <div className="mt-4">
            <Link
              href={`/admin/sites/${siteId}/theme`}
              className="text-sm font-medium underline"
            >
              {t('sites.edit.themeLink')}
            </Link>
          </div>
        </div>

        <SiteSettingsForm initial={initial} fallback={fallback} />
      </div>
    )
  }

  return EditSitePage
}
