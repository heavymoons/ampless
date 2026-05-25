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

// Polling cadence + ceiling for the post-switch S3 propagation wait.
// 1s interval × 30 attempts = 30 s budget — generous for the typical
// processor turnaround (~1–3 s after the KvStore stream fires) without
// pinning a user UI thread forever if the processor pipeline is wedged.
const POLL_INTERVAL_MS = 1000
const POLL_MAX_ATTEMPTS = 30

/**
 * Theme admin: pick which installed theme is active, plus edit the
 * active theme's customizable manifest fields. Reads through the S3
 * site-settings cache (same path the public site uses) so the admin
 * sees the same effective state visitors see.
 *
 * The full `themeList` (one entry per installed theme manifest) is
 * passed in because the registry lives in the user's project — admin
 * stays agnostic of which themes a project happens to install.
 *
 * The `[siteId]` param appears in the route signature for the
 * internal URL structure; its value isn't used.
 */
export function createSiteThemePage(admin: Admin, themeList: ReadonlyArray<ThemeListEntry>) {
  const { cmsConfig, t, locale, loadThemeConfig, readStoredActiveThemeFresh } = admin

  // Inline server action: poll the S3 cache until `theme.active`
  // matches the expected value, then return. Used by the form after
  // a theme switch to defer the post-switch hard reload until the
  // trusted processor has propagated the KvStore write — without
  // this, the reload races the S3 rebuild and serves the pre-switch
  // theme for up to a minute (the Next.js fetch cache TTL).
  //
  // Closed over `admin` (which carries the lazy ampless thunk). Each
  // poll iteration goes to S3 with `cache: 'no-store'`, so there's no
  // Next.js fetch cache interference even when admin and public share
  // a Lambda.
  async function pollActiveTheme(expected: string): Promise<boolean> {
    'use server'
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      try {
        const current = await readStoredActiveThemeFresh()
        if (current === expected) return true
      } catch (err) {
        // Transient fetch failures (storage 404 before the file is
        // ever written, network blip) shouldn't kill the loop —
        // keep polling until the deadline.
        console.warn('[site-theme] poll iteration failed', err)
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    }
    return false
  }

  async function ThemePage({ params }: Props) {
    const { siteId } = await params
    const theme = await loadThemeConfig()

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
          manifest={theme.manifest}
          activeTheme={theme.activeTheme}
          themeOptions={themeOptions}
          initial={theme.values}
          initialColorScheme={theme.colorScheme}
          pollActiveTheme={pollActiveTheme}
        />
      </div>
    )
  }

  return ThemePage
}
