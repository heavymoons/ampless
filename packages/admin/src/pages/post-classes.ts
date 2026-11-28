import { resolveLocalized, themePostClasses, type ThemeManifest } from 'ampless'
import type { EditorPostClass } from '../components/post-form.js'

interface ThemeAwareAdmin {
  locale?: string
  loadThemeConfig?: () => Promise<{ manifest: ThemeManifest }>
}

/**
 * Server-side: the active theme's post custom classes (`target: 'post'`),
 * with labels resolved for the admin locale, for the post editor's
 * "Post classes" checkboxes. Mirrors `loadEditorTableClasses`.
 *
 * A missing `loadThemeConfig` (old callers, tests) or a failure loading the
 * theme yields `[]` — the editor keeps working, and ids already stored on a
 * post are still shown (as "not in current theme") and preserved; only the
 * offered list is empty. Failures are logged, not swallowed silently.
 */
export async function loadEditorPostClasses(admin: unknown): Promise<EditorPostClass[]> {
  const a = (admin ?? {}) as ThemeAwareAdmin
  if (typeof a.loadThemeConfig !== 'function') return []
  try {
    const { manifest } = await a.loadThemeConfig()
    const locale = typeof a.locale === 'string' ? a.locale : 'en'
    return themePostClasses(manifest).map((c) => {
      const out: EditorPostClass = { id: c.id, label: resolveLocalized(c.label, locale) || c.id }
      if (c.description) out.description = resolveLocalized(c.description, locale)
      return out
    })
  } catch (err) {
    console.error('[ampless admin] could not load the active theme for post classes; the editor offers none', err)
    return []
  }
}
