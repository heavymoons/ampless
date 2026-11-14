import { resolveLocalized, themeTableClasses, type ThemeManifest } from 'ampless'
import type { EditorTableClass } from '../editor/table-classes-context.js'

interface ThemeAwareAdmin {
  locale?: string
  loadThemeConfig?: () => Promise<{ manifest: ThemeManifest }>
}

/**
 * Server-side: the active theme's table custom classes, with labels resolved
 * for the admin locale, for the post editor's table controls.
 *
 * `admin` is the object the template already passes to `createEditPostPage` /
 * `createNewPostPage` (`createAdmin(...)`). A missing `loadThemeConfig` (old
 * callers, tests) or a failure loading the theme yields `[]` — the editor
 * keeps working and existing table classes are preserved; only the offered
 * list is empty. Failures are logged, not swallowed silently.
 */
export async function loadEditorTableClasses(admin: unknown): Promise<EditorTableClass[]> {
  const a = (admin ?? {}) as ThemeAwareAdmin
  if (typeof a.loadThemeConfig !== 'function') return []
  try {
    const { manifest } = await a.loadThemeConfig()
    const locale = typeof a.locale === 'string' ? a.locale : 'en'
    return themeTableClasses(manifest).map((c) => {
      const out: EditorTableClass = { id: c.id, label: resolveLocalized(c.label, locale) || c.id }
      if (c.description) out.description = resolveLocalized(c.description, locale)
      return out
    })
  } catch (err) {
    console.error('[ampless admin] could not load the active theme for table styles; the editor offers none', err)
    return []
  }
}
