import Link from 'next/link'
import { siteFor } from 'ampless'
import cmsConfig from '@/cms.config'
import themeManifest from '@/theme.manifest'
import { loadThemeConfig } from '@/lib/theme-config'
import { ThemeSettingsForm } from '@/components/admin/theme-settings-form'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ siteId: string }>
}

// Server-rendered: pulls effective theme values from the S3 settings
// cache (same pipeline the public site uses). KvStore reads happen on
// the client only — the AppSync-backed provider lives in providers.tsx
// — so server pages must always go through the cached JSON. Trade-off:
// the admin sees their own write reflected after the cache rebuilds
// (~60s); the form's `touched` state covers the in-session UI.
export default async function ThemePage({ params }: Props) {
  const { siteId } = await params
  const site = siteFor(siteId, cmsConfig)
  const theme = await loadThemeConfig(siteId)

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
        initial={theme.values}
      />
    </div>
  )
}
