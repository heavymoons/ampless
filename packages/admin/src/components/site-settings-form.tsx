'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setSiteSetting } from 'ampless'
import { Button, Input, Label, Textarea } from '@ampless/runtime/ui'
import { useT } from './i18n-provider.js'

export interface SiteSettingsFormValues {
  'site.name'?: string
  'site.url'?: string
  'site.description'?: string
  'media.imageDisplay'?: 'inline' | 'lightbox'
  'media.imageMaxWidth'?: string
  dateFormat?: 'iso' | 'long' | 'locale'
  timezone?: string
}

interface Props {
  siteId: string
  initial: SiteSettingsFormValues
  /** Defaults from cms.config.ts shown as placeholders. */
  fallback: SiteSettingsFormValues
}

const KEYS: Array<keyof SiteSettingsFormValues> = [
  'site.name',
  'site.url',
  'site.description',
  'media.imageDisplay',
  'media.imageMaxWidth',
  'dateFormat',
  'timezone',
]

export function SiteSettingsForm({ siteId, initial, fallback }: Props) {
  const router = useRouter()
  const t = useT()
  const [values, setValues] = useState<SiteSettingsFormValues>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  function update<K extends keyof SiteSettingsFormValues>(
    key: K,
    value: SiteSettingsFormValues[K]
  ) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setInfo(null)
    try {
      await Promise.all(
        KEYS.map((key) => {
          const value = values[key]
          // Empty / undefined → skip (could also delete the row, but
          // updates without explicit "reset to default" feel safer).
          if (value === undefined || value === '') return Promise.resolve()
          return setSiteSetting(siteId, key, value)
        })
      )
      setInfo(t('sites.edit.saved'))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-6 max-w-xl">
      <fieldset className="space-y-4">
        <legend className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t('sites.edit.site')}
        </legend>
        <div className="space-y-2">
          <Label htmlFor="name">{t('common.name')}</Label>
          <Input
            id="name"
            value={values['site.name'] ?? ''}
            placeholder={fallback['site.name'] ?? ''}
            onChange={(e) => update('site.name', e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="url">{t('common.url')}</Label>
          <Input
            id="url"
            value={values['site.url'] ?? ''}
            placeholder={fallback['site.url'] ?? ''}
            onChange={(e) => update('site.url', e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">{t('common.description')}</Label>
          <Textarea
            id="description"
            value={values['site.description'] ?? ''}
            placeholder={fallback['site.description'] ?? ''}
            rows={2}
            onChange={(e) => update('site.description', e.target.value)}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t('sites.edit.media')}
        </legend>
        <div className="space-y-2">
          <Label htmlFor="imageDisplay">{t('sites.edit.imageDisplay')}</Label>
          <select
            id="imageDisplay"
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={values['media.imageDisplay'] ?? ''}
            onChange={(e) =>
              update('media.imageDisplay', e.target.value as 'inline' | 'lightbox')
            }
          >
            <option value="">
              {t('sites.edit.defaultPlaceholder', {
                value: fallback['media.imageDisplay'] ?? 'inline',
              })}
            </option>
            <option value="inline">{t('sites.edit.imageDisplayInline')}</option>
            <option value="lightbox">{t('sites.edit.imageDisplayLightbox')}</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="imageMaxWidth">{t('sites.edit.imageMaxWidth')}</Label>
          <Input
            id="imageMaxWidth"
            value={values['media.imageMaxWidth'] ?? ''}
            placeholder={fallback['media.imageMaxWidth'] ?? '100%'}
            onChange={(e) => update('media.imageMaxWidth', e.target.value)}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t('sites.edit.dateDisplay')}
        </legend>
        <div className="space-y-2">
          <Label htmlFor="dateFormat">{t('sites.edit.dateFormat')}</Label>
          <select
            id="dateFormat"
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={values['dateFormat'] ?? ''}
            onChange={(e) =>
              update('dateFormat', e.target.value as 'iso' | 'long' | 'locale')
            }
          >
            <option value="">
              {t('sites.edit.defaultPlaceholder', {
                value: fallback['dateFormat'] ?? 'iso',
              })}
            </option>
            <option value="iso">{t('sites.edit.dateFormatIso')}</option>
            <option value="long">{t('sites.edit.dateFormatLong')}</option>
            <option value="locale">{t('sites.edit.dateFormatLocale')}</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="timezone">{t('sites.edit.timezone')}</Label>
          <Input
            id="timezone"
            value={values['timezone'] ?? ''}
            placeholder={fallback['timezone'] ?? 'UTC'}
            onChange={(e) => update('timezone', e.target.value)}
          />
        </div>
      </fieldset>

      {info && <p className="text-sm text-muted-foreground">{info}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={saving}>
        {saving ? t('common.saving') : t('sites.edit.saveButton')}
      </Button>
    </form>
  )
}
