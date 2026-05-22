import Link from 'next/link'
import { resolveLocalized, type ThemeManifest, type LocalizedString } from 'ampless'
import type { Admin } from '../index.js'
import { ThemeSettingsForm } from '../components/theme-settings-form.js'

interface Props {
  params: Promise<{ siteId: string }>
}

interface ThemeListEntry {
  name: string
  manifest: ThemeManifest
}

/**
 * Theme admin: pick which installed theme is active for the site, plus
 * edit the active theme's customizable manifest fields. Reads through
 * the S3 site-settings cache (same path the public site uses) so the
 * admin sees the same effective state visitors see.
 *
 * The full `themeList` (one entry per installed theme manifest) is
 * passed in because the registry lives in the user's project — admin
 * stays agnostic of which themes a project happens to install.
 *
 * ampless runs one site per Amplify deployment; the `siteId` param is
 * always `'default'` in practice.
 */
export function createSiteThemePage(admin: Admin, themeList: ReadonlyArray<ThemeListEntry>) {
  const { cmsConfig, t, locale, loadThemeConfig } = admin

  async function ThemePage({ params }: Props) {
    const { siteId } = await params
    const theme = await loadThemeConfig(siteId)

    const themeOptions = themeList.map((m) => ({
      value: m.name,
      label: m.manifest.label as LocalizedString,
      description: m.manifest.description as LocalizedString | undefined,
    }))

    return (
      <div className="mx-auto max-w-7xl p-4 md:p-8">
        <div className="mb-6 md:mb-8">
          <Link
            href={`/admin/sites/${siteId}`}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← {cmsConfig.site.name}
          </Link>
          <h1 className="mt-2 text-2xl font-bold md:text-3xl">{t('theme.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('common.active')}:{' '}
            <strong>{resolveLocalized(theme.manifest.label, locale)}</strong> ({theme.activeTheme})
          </p>
        </div>

        <ThemeSettingsForm
          siteId={siteId}
          manifest={theme.manifest}
          activeTheme={theme.activeTheme}
          themeOptions={themeOptions}
          initial={theme.values}
          initialColorScheme={theme.colorScheme}
        />
      </div>
    )
  }

  return ThemePage
}
