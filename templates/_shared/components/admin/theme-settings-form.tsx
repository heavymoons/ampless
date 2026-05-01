'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  setSiteSetting,
  deleteSiteSetting,
  themeSettingKey,
  validateThemeValue,
  type ThemeManifest,
  type ThemeField,
} from 'ampless'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Props {
  siteId: string
  manifest: ThemeManifest
  /** Resolved values currently shown to the user (overrides ?? defaults). */
  initial: Record<string, string>
}

interface ChangeState {
  /** Field key → user-entered raw value (string). Empty means cleared. */
  values: Record<string, string>
  /** Field key → true if user has touched this field this session. */
  touched: Record<string, boolean>
}

export function ThemeSettingsForm({ siteId, manifest, initial }: Props) {
  const router = useRouter()
  const [state, setState] = useState<ChangeState>({ values: initial, touched: {} })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [invalid, setInvalid] = useState<Record<string, boolean>>({})

  function update(key: string, value: string) {
    setState((prev) => ({
      values: { ...prev.values, [key]: value },
      touched: { ...prev.touched, [key]: true },
    }))
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setInfo(null)
    setInvalid({})

    const newInvalid: Record<string, boolean> = {}
    const writes: Promise<unknown>[] = []

    for (const field of manifest.fields) {
      // Only persist fields the user actually touched. Leaving a field
      // alone shouldn't blow away an override they set previously, but
      // also shouldn't write the resolved-default back as if it were
      // explicit.
      if (!state.touched[field.key]) continue

      const raw = (state.values[field.key] ?? '').trim()
      const storeKey = themeSettingKey(field.key)

      if (raw === '') {
        // Empty input means "reset to default" — drop the override.
        writes.push(deleteSiteSetting(siteId, storeKey))
        continue
      }

      const validated = validateThemeValue(field, raw)
      if (validated === null) {
        newInvalid[field.key] = true
        continue
      }
      writes.push(setSiteSetting(siteId, storeKey, validated))
    }

    if (Object.keys(newInvalid).length > 0) {
      setInvalid(newInvalid)
      setSaving(false)
      setError('One or more values are invalid — fix highlighted fields and try again.')
      return
    }

    try {
      await Promise.all(writes)
      setInfo(
        'Saved. The public site refreshes within ~1 minute (S3 cache + Next.js fetch cache).'
      )
      // Clear touched flags so the next save round only writes new edits.
      setState((prev) => ({ values: prev.values, touched: {} }))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const groups = groupFields(manifest.fields)

  return (
    <form onSubmit={save} className="space-y-6 max-w-xl">
      {groups.map(({ name, fields }) => (
        <fieldset key={name} className="space-y-4">
          <legend className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {name}
          </legend>
          {fields.map((field) => (
            <FieldRow
              key={field.key}
              field={field}
              value={state.values[field.key] ?? ''}
              invalid={!!invalid[field.key]}
              onChange={(v) => update(field.key, v)}
            />
          ))}
        </fieldset>
      ))}

      {info && <p className="text-sm text-muted-foreground">{info}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={saving}>
        {saving ? 'Saving...' : 'Save theme'}
      </Button>
    </form>
  )
}

function groupFields(
  fields: ReadonlyArray<ThemeField>
): Array<{ name: string; fields: ThemeField[] }> {
  const map = new Map<string, ThemeField[]>()
  for (const field of fields) {
    const g = field.group ?? 'General'
    const arr = map.get(g) ?? []
    arr.push(field)
    map.set(g, arr)
  }
  return Array.from(map.entries()).map(([name, fields]) => ({ name, fields }))
}

interface FieldRowProps {
  field: ThemeField
  value: string
  invalid: boolean
  onChange: (v: string) => void
}

function FieldRow({ field, value, invalid, onChange }: FieldRowProps) {
  const id = `theme-${field.key}`
  const labelEl = (
    <Label htmlFor={id} className={invalid ? 'text-destructive' : undefined}>
      {field.label}
    </Label>
  )
  const description = field.description ? (
    <p className="text-xs text-muted-foreground">{field.description}</p>
  ) : null

  switch (field.type) {
    case 'color':
      return (
        <div className="space-y-2">
          {labelEl}
          {description}
          <div className="flex gap-2">
            <Input
              id={id}
              value={value}
              placeholder={field.default}
              onChange={(e) => onChange(e.target.value)}
              aria-invalid={invalid}
              className="font-mono text-xs"
            />
          </div>
          <ColorPreview value={value || field.default} />
        </div>
      )
    case 'length':
      return (
        <div className="space-y-2">
          {labelEl}
          {description}
          <Input
            id={id}
            value={value}
            placeholder={field.default}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={invalid}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            CSS length, e.g. <code>0.5rem</code>, <code>4px</code>.
          </p>
        </div>
      )
    case 'select':
    case 'fontFamily':
      return (
        <div className="space-y-2">
          {labelEl}
          {description}
          <select
            id={id}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={invalid}
          >
            <option value="">Default</option>
            {field.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )
    case 'image':
      return (
        <div className="space-y-2">
          {labelEl}
          {description}
          <Input
            id={id}
            value={value}
            placeholder={field.default || 'https://… or /media/…'}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={invalid}
          />
        </div>
      )
    case 'text':
      return (
        <div className="space-y-2">
          {labelEl}
          {description}
          <Input
            id={id}
            value={value}
            placeholder={field.default}
            maxLength={field.maxLength}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={invalid}
          />
        </div>
      )
  }
}

function ColorPreview({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-block h-6 w-12 rounded border"
        style={{ background: value }}
        aria-hidden
      />
      <code className="text-xs text-muted-foreground">{value}</code>
    </div>
  )
}
