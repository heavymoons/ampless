'use client'

import { Button } from '@ampless/runtime/ui'
import { useT } from './i18n-provider.js'

/**
 * A post custom class the active theme declares (ThemeManifest.customClasses
 * with target 'post'), with its label already resolved for the admin locale.
 * Serializable so the server page factory can pass it to the client form.
 */
export interface EditorPostClass {
  id: string
  label: string
  description?: string
}

interface PostClassesFieldProps {
  /** The active theme's post classes (offered as checkboxes). */
  available: ReadonlyArray<EditorPostClass>
  /** The post's selected ids (already normalized), in stored order. */
  value: ReadonlyArray<string>
  onChange: (next: string[]) => void
}

/**
 * "Post styles" section of the post settings. Declared classes are
 * checkboxes; stored ids the active theme does not declare (e.g. after a
 * theme switch) are listed, flagged and removable — never dropped silently,
 * since they keep rendering as `ampless-post--<id>`. Renders nothing when the
 * theme declares none and the post has none stored.
 */
export function PostClassesField({ available, value, onChange }: PostClassesFieldProps) {
  const t = useT()
  const declared = new Set(available.map((c) => c.id))
  const undeclared = value.filter((id) => !declared.has(id))
  if (available.length === 0 && value.length === 0) return null

  function toggle(id: string, checked: boolean) {
    // Keep the stored order for existing ids; a newly checked id goes last.
    onChange(checked ? (value.includes(id) ? [...value] : [...value, id]) : value.filter((v) => v !== id))
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t('posts.form.postClasses')}</legend>
      {available.length > 0 ? (
        <p className="text-xs text-muted-foreground">{t('posts.form.postClassesHint')}</p>
      ) : (
        <p className="text-xs text-muted-foreground">{t('posts.form.postClassesNoneDeclared')}</p>
      )}
      {available.map((c) => (
        <label key={c.id} className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.includes(c.id)}
            onChange={(e) => toggle(c.id, e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="font-medium">{c.label}</span>
            {c.description && (
              <span className="block text-xs text-muted-foreground">{c.description}</span>
            )}
          </span>
        </label>
      ))}
      {undeclared.length > 0 && (
        <ul className="space-y-1">
          {undeclared.map((id) => (
            <li key={id} className="flex items-center gap-2 text-sm" data-testid="post-class-undeclared">
              <span className="text-amber-600 dark:text-amber-400">
                {t('posts.form.postClassesUnknown', { id })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t('posts.form.postClassesRemove', { id })}
                onClick={() => toggle(id, false)}
              >
                {t('common.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {undeclared.length > 0 && (
        <p className="text-xs text-muted-foreground">{t('posts.form.postClassesUnknownHint')}</p>
      )}
    </fieldset>
  )
}
