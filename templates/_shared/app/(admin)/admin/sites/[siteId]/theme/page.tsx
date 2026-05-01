import Link from 'next/link'
import { siteFor, listSiteSettings, themeSettingKey, resolveThemeValues } from 'ampless'
import cmsConfig from '@/cms.config'
import themeManifest from '@/theme.manifest'
import { ThemeSettingsForm } from '@/components/admin/theme-settings-form'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ siteId: string }>
}

// Server-rendered: pulls every `theme.*` setting straight from KvStore
// (bypasses the S3 cache so admin sees their own writes immediately).
// The form renders fields off the manifest; storage keys are resolved
// via `themeSettingKey` so the form and the loader stay in sync.
export default async function ThemePage({ params }: Props) {
  const { siteId } = await params
  const site = siteFor(siteId, cmsConfig)
  const allSettings = await listSiteSettings(siteId)

  const stored: Record<string, unknown> = {}
  for (const field of themeManifest.fields) {
    const k = themeSettingKey(field.key)
    if (k in allSettings) stored[k] = allSettings[k]
  }
  const initial = resolveThemeValues(themeManifest, stored)

  return (
    <div className="p-8">
      <div className="mb-8">
        <Link
          href={`/admin/sites/${siteId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {site.name}
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Theme — {themeManifest.label}</h1>
        {themeManifest.description && (
          <p className="text-sm text-muted-foreground">{themeManifest.description}</p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Customizable fields are declared in <code>theme.manifest.ts</code>.
          Empty input resets to the manifest default.
        </p>
      </div>

      <ThemeSettingsForm
        siteId={siteId}
        manifest={themeManifest}
        initial={initial}
      />
    </div>
  )
}
