'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setSiteSetting } from 'ampless'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

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
      setInfo(
        'Saved. The public site refreshes within ~1 minute (S3 cache + Next.js fetch cache).'
      )
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
          Site
        </legend>
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={values['site.name'] ?? ''}
            placeholder={fallback['site.name'] ?? ''}
            onChange={(e) => update('site.name', e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="url">URL</Label>
          <Input
            id="url"
            value={values['site.url'] ?? ''}
            placeholder={fallback['site.url'] ?? ''}
            onChange={(e) => update('site.url', e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
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
          Media
        </legend>
        <div className="space-y-2">
          <Label htmlFor="imageDisplay">Image display</Label>
          <select
            id="imageDisplay"
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={values['media.imageDisplay'] ?? ''}
            onChange={(e) =>
              update('media.imageDisplay', e.target.value as 'inline' | 'lightbox')
            }
          >
            <option value="">Default ({fallback['media.imageDisplay'] ?? 'inline'})</option>
            <option value="inline">Inline</option>
            <option value="lightbox">Lightbox</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="imageMaxWidth">Image max width (CSS)</Label>
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
          Date display
        </legend>
        <div className="space-y-2">
          <Label htmlFor="dateFormat">Format</Label>
          <select
            id="dateFormat"
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={values['dateFormat'] ?? ''}
            onChange={(e) =>
              update('dateFormat', e.target.value as 'iso' | 'long' | 'locale')
            }
          >
            <option value="">Default ({fallback['dateFormat'] ?? 'iso'})</option>
            <option value="iso">ISO (YYYY-MM-DD)</option>
            <option value="long">Long (April 27, 2026)</option>
            <option value="locale">Locale</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="timezone">Timezone (IANA)</Label>
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
        {saving ? 'Saving...' : 'Save settings'}
      </Button>
    </form>
  )
}
