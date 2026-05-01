import Link from 'next/link'
import { siteFor } from 'ampless'
import cmsConfig from '@/cms.config'
import { themeList } from '@/themes-registry'
import { loadThemeConfig } from '@/lib/theme-config'
import { ThemeSettingsForm } from '@/components/admin/theme-settings-form'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ siteId: string }>
}

// Theme admin: pick which installed theme is active for this site, plus
// edit the active theme's customizable manifest fields. Reads through
// the S3 site-settings cache (same path the public site uses) so the
// admin sees the same effective state visitors see.
export default async function ThemePage({ params }: Props) {
  const { siteId } = await params
  const site = siteFor(siteId, cmsConfig)
  const theme = await loadThemeConfig(siteId)

  const themeOptions = themeList.map((t) => ({
    value: t.name,
    label: t.manifest.label,
    description: t.manifest.description,
  }))

  return (
    <div className="p-8">
      <div className="mb-8">
        <Link
          href={`/admin/sites/${siteId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {site.name}
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Theme</h1>
        <p className="text-sm text-muted-foreground">
          Active: <strong>{theme.manifest.label}</strong> ({theme.activeTheme})
        </p>
      </div>

      <ThemeSettingsForm
        siteId={siteId}
        manifest={theme.manifest}
        activeTheme={theme.activeTheme}
        themeOptions={themeOptions}
        initial={theme.values}
      />
    </div>
  )
}
