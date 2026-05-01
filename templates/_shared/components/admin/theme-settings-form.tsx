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

interface ThemeOption {
  value: string
  label: string
  description?: string
}

interface Props {
  siteId: string
  manifest: ThemeManifest
  activeTheme: string
  themeOptions: ThemeOption[]
  /** Resolved values currently shown to the user (overrides ?? defaults). */
  initial: Record<string, string>
}

interface ChangeState {
  /** Field key → user-entered raw value (string). Empty means cleared. */
  values: Record<string, string>
  /** Field key → true if user has touched this field this session. */
  touched: Record<string, boolean>
}

export function ThemeSettingsForm({
  siteId,
  manifest,
  activeTheme,
  themeOptions,
  initial,
}: Props) {
  const router = useRouter()
  const [state, setState] = useState<ChangeState>({ values: initial, touched: {} })
  const [pendingTheme, setPendingTheme] = useState<string>(activeTheme)
  const [saving, setSaving] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [invalid, setInvalid] = useState<Record<string, boolean>>({})

  function update(key: string, value: string) {
    setState((prev) => ({
      values: { ...prev.values, [key]: value },
      touched: { ...prev.touched, [key]: true },
    }))
  }

  async function switchTheme(e: React.FormEvent) {
    e.preventDefault()
    if (pendingTheme === activeTheme) return
    setSwitching(true)
    setError(null)
    setInfo(null)
    try {
      await setSiteSetting(siteId, 'theme.active', pendingTheme)
      setInfo(
        `Switched to ${pendingTheme}. Reload after the cache refreshes (~1 min) to see the new manifest fields.`
      )
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSwitching(false)
    }
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
    <div className="space-y-8 max-w-xl">
      {/* Theme switcher — separate form so changing the active theme
          triggers a refresh that re-renders this page with the new
          theme's manifest fields. */}
      <form onSubmit={switchTheme} className="space-y-3 rounded-md border p-4">
        <div className="space-y-1">
          <Label htmlFor="active-theme" className="text-sm font-medium">
            Active theme
          </Label>
          <p className="text-xs text-muted-foreground">
            Switching changes which theme renders this site. Each installed
            theme exposes its own customization fields.
          </p>
        </div>
        <select
          id="active-theme"
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          value={pendingTheme}
          onChange={(e) => setPendingTheme(e.target.value)}
        >
          {themeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label} ({opt.value})
            </option>
          ))}
        </select>
        {themeOptions.find((o) => o.value === pendingTheme)?.description && (
          <p className="text-xs text-muted-foreground">
            {themeOptions.find((o) => o.value === pendingTheme)?.description}
          </p>
        )}
        <Button
          type="submit"
          disabled={switching || pendingTheme === activeTheme}
          variant={pendingTheme === activeTheme ? 'outline' : 'default'}
        >
          {switching ? 'Switching...' : 'Switch theme'}
        </Button>
      </form>

      {/* Manifest fields for the currently active theme. */}
      <form onSubmit={save} className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">{manifest.label} customization</h2>
          {manifest.description && (
            <p className="text-sm text-muted-foreground">{manifest.description}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Empty input resets to the manifest default.
          </p>
        </div>

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
    </div>
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
      return <ColorField field={field} id={id} labelEl={labelEl} description={description} value={value} invalid={invalid} onChange={onChange} />

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

interface ColorFieldProps {
  field: ThemeField & { type: 'color' }
  id: string
  labelEl: React.ReactNode
  description: React.ReactNode
  value: string
  invalid: boolean
  onChange: (v: string) => void
}

/**
 * Color picker with two layers:
 *   1. Native `<input type="color">` swatch (a no-dep, no-popup,
 *      browser-rendered picker).
 *   2. A text Input for advanced syntax (`oklch(...)`, `hsl(...)`).
 *
 * The picker only natively understands `#rrggbb`, but a canvas trick
 * lets the browser parse any CSS color and round-trip it to hex —
 * including `oklch()` (Chromium 111+, Firefox 113+, Safari 16.4+).
 * When the user picks via the swatch, we write hex; when they type
 * `oklch(...)` in the text field, we keep it verbatim.
 */
function ColorField({
  field,
  id,
  labelEl,
  description,
  value,
  invalid,
  onChange,
}: ColorFieldProps) {
  const effective = value || field.default
  const hex = useColorAsHex(effective)
  return (
    <div className="space-y-2">
      {labelEl}
      {description}
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded border border-input bg-background p-0"
          aria-label={`${field.label} swatch`}
        />
        <Input
          id={id}
          value={value}
          placeholder={field.default}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
          className="font-mono text-xs"
        />
      </div>
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-4 w-4 rounded border"
          style={{ background: effective }}
          aria-hidden
        />
        <code className="text-xs text-muted-foreground">{effective}</code>
      </div>
    </div>
  )
}

/**
 * Resolve any CSS color string (hex / rgb / hsl / oklch / named) to
 * `#rrggbb` for the native color picker. Uses canvas color parsing,
 * which round-trips any color the browser can render. Falls back to
 * black when parsing fails or on the server (SSR).
 */
function useColorAsHex(value: string): string {
  if (typeof document === 'undefined') return '#000000'
  const m = /^#([0-9a-fA-F]{6})$/.exec(value)
  if (m) return value.toLowerCase()
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return '#000000'
    // Reset to a known value; if the next assignment is invalid the
    // previous fillStyle survives, which we don't want.
    ctx.fillStyle = '#000000'
    ctx.fillStyle = value
    const out = ctx.fillStyle as string
    return /^#[0-9a-fA-F]{6}$/.test(out) ? out : '#000000'
  } catch {
    return '#000000'
  }
}
