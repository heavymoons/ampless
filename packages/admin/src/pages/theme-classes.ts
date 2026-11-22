import {
  resolveLocalized,
  themePostClasses,
  themeTableClasses,
  type ThemeCustomClass,
  type ThemeManifest,
} from 'ampless'
import type { EditorTableClass } from '../editor/table-classes-context.js'
import type { EditorPostClass } from '../components/post-classes-field.js'

interface ThemeAwareAdmin {
  locale?: string
  loadThemeConfig?: () => Promise<{ manifest: ThemeManifest }>
}

/** The active theme's custom classes, per target, for the post editor. */
export interface EditorThemeClasses {
  /** `target: 'table'` entries, for the editor's table controls. */
  tableClasses: EditorTableClass[]
  /** `target: 'post'` entries, for the post settings' "Post styles". */
  postClasses: EditorPostClass[]
}

function toEditorClass(c: ThemeCustomClass, locale: string): EditorTableClass {
  const out: EditorTableClass = { id: c.id, label: resolveLocalized(c.label, locale) || c.id }
  if (c.description) out.description = resolveLocalized(c.description, locale)
  return out
}

/**
 * Server-side: the active theme's table and post custom classes, with labels
 * resolved for the admin locale. The manifest is read once for both lists.
 *
 * `admin` is the object the template already passes to `createEditPostPage` /
 * `createNewPostPage` (`createAdmin(...)`). A missing `loadThemeConfig` (old
 * callers, tests) or a failure loading the theme yields empty lists — the
 * editor keeps working and classes already stored in the post are preserved;
 * only the offered lists are empty. Failures are logged, not swallowed
 * silently.
 */
export async function loadEditorThemeClasses(admin: unknown): Promise<EditorThemeClasses> {
  const a = (admin ?? {}) as ThemeAwareAdmin
  if (typeof a.loadThemeConfig !== 'function') return { tableClasses: [], postClasses: [] }
  try {
    const { manifest } = await a.loadThemeConfig()
    const locale = typeof a.locale === 'string' ? a.locale : 'en'
    return {
      tableClasses: themeTableClasses(manifest).map((c) => toEditorClass(c, locale)),
      postClasses: themePostClasses(manifest).map((c) => toEditorClass(c, locale)),
    }
  } catch (err) {
    console.error(
      '[ampless admin] could not load the active theme for table / post styles; the editor offers none',
      err,
    )
    return { tableClasses: [], postClasses: [] }
  }
}
