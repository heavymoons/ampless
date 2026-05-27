'use client'

// Admin form for `AmplessPlugin.settings.public` (Phase 2).
//
// One form per plugin instance. Renders one input per declared field,
// tracks which fields the user actually touched, and on save writes
// only the touched fields to DDB. Untouched fields are left alone so
// that future changes to a plugin's `default` (from a package update
// or a `cms.config.ts` edit) still take effect — explicitly saving
// the resolved default would freeze it.
//
// Cache invalidation follows the theme-settings-form pattern: after
// every write batch we schedule a single `invalidateSiteSettingsCache`
// call after ~8s, which is the typical S3-rebuild budget. Immediate
// invalidation would race the trusted processor and re-populate the
// Next.js fetch cache with the pre-save value.

import { useState } from 'react'
import {
  resolveLocalized,
  type LocalizedString,
  type PluginSettingField,
} from 'ampless'
import { Button, Input, Label, Textarea } from '@ampless/runtime/ui'
import {
  setPluginPublicSetting,
  deletePluginPublicSetting,
} from '../lib/plugin-settings.js'
import { invalidateSiteSettingsCache } from '../lib/theme-actions.js'
import { useT, useLocale } from './i18n-provider.js'

// Same delay as theme-settings-form. The trusted processor rebuilds
// the S3 cache JSON in 5–10 s; firing earlier risks re-fetching the
// old version into the Next fetch cache.
const CACHE_REBUILD_DELAY_MS = 8000

interface Props {
  instanceId: string
  displayName?: LocalizedString
  fields: ReadonlyArray<PluginSettingField>
  /**
   * Existing stored values for this instance keyed by field `key`.
   * Empty object means "no overrides yet"; the placeholders + defaults
   * still come through the manifest.
   */
  initialValues: Record<string, unknown>
}

interface FormState {
  /** Raw input values keyed by field key (always strings while editing;
   *  parsed on save). */
  values: Record<string, string>
  touched: Record<string, boolean>
  invalid: Record<string, boolean>
}

/**
 * Stringify a stored value for display in the form. JSON / boolean /
 * number fields are coerced into a string representation; the save
 * path re-parses on the way out. Mirrors how theme-settings-form
 * handles its non-string `linkList` field.
 */
function stringify(field: PluginSettingField, raw: unknown): string {
  if (raw === undefined || raw === null) return ''
  switch (field.type) {
    case 'boolean':
      return raw === true ? 'true' : raw === false ? 'false' : String(raw)
    case 'json':
      if (typeof raw === 'string') return raw
      try {
        return JSON.stringify(raw, null, 2)
      } catch {
        return ''
      }
    default:
      return typeof raw === 'string' ? raw : String(raw)
  }
}

/**
 * Convert a form input string back into the value shape the field
 * expects. Returns the parsed value, or `null` on parse failure (the
 * caller treats that as an "invalid" form error). `validatePluginSettingValue`
 * runs again inside `setPluginPublicSetting` for the security check;
 * this is just shape-decoding.
 */
function parse(field: PluginSettingField, raw: string): unknown | null {
  switch (field.type) {
    case 'boolean':
      if (raw === 'true') return true
      if (raw === 'false') return false
      return null
    case 'number': {
      const trimmed = raw.trim()
      if (trimmed === '') return null
      const n = Number(trimmed)
      return Number.isNaN(n) ? null : n
    }
    case 'json': {
      const trimmed = raw.trim()
      if (trimmed === '') return null
      try {
        return JSON.parse(trimmed)
      } catch {
        return null
      }
    }
    default:
      return raw
  }
}

export function PluginSettingsForm({
  instanceId,
  displayName,
  fields,
  initialValues,
}: Props) {
  const t = useT()
  const locale = useLocale()

  const [state, setState] = useState<FormState>(() => {
    const values: Record<string, string> = {}
    for (const field of fields) {
      const has = Object.prototype.hasOwnProperty.call(initialValues, field.key)
      values[field.key] = has ? stringify(field, initialValues[field.key]) : ''
    }
    return { values, touched: {}, invalid: {} }
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  function update(key: string, value: string) {
    setState((prev) => ({
      values: { ...prev.values, [key]: value },
      touched: { ...prev.touched, [key]: true },
      invalid: { ...prev.invalid, [key]: false },
    }))
    setInfo(null)
  }

  function scheduleCacheInvalidation() {
    setTimeout(async () => {
      try {
        await invalidateSiteSettingsCache()
      } catch (err) {
        console.warn('[plugin] cache invalidation failed', err)
      }
    }, CACHE_REBUILD_DELAY_MS)
  }

  async function reset(field: PluginSettingField) {
    setError(null)
    setInfo(null)
    try {
      await deletePluginPublicSetting(instanceId, field)
      // Clear the in-form value back to empty so the placeholder /
      // default takes over visually. Also clear `touched` for this
      // field so the next save() doesn't re-write it.
      setState((prev) => ({
        values: { ...prev.values, [field.key]: '' },
        touched: { ...prev.touched, [field.key]: false },
        invalid: { ...prev.invalid, [field.key]: false },
      }))
      setInfo(t('plugins.resetDone'))
      scheduleCacheInvalidation()
    } catch (err) {
      console.error('[plugin] reset failed', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setInfo(null)

    const newInvalid: Record<string, boolean> = {}
    const writes: Array<Promise<unknown>> = []

    for (const field of fields) {
      if (!state.touched[field.key]) continue
      const raw = state.values[field.key] ?? ''
      const parsed = parse(field, raw)
      if (parsed === null && raw !== '') {
        newInvalid[field.key] = true
        continue
      }
      // For string-like fields parse() returns the raw string (or
      // empty string). For non-string fields, parse() of '' is null
      // — we treat that as "skip this field" rather than "save
      // empty" since empty isn't a valid value there. Resetting to
      // default goes through the explicit "Reset" button.
      if (parsed === null) continue
      writes.push(setPluginPublicSetting(instanceId, field, parsed))
    }

    if (Object.keys(newInvalid).length > 0) {
      setState((prev) => ({ ...prev, invalid: newInvalid }))
      setSaving(false)
      setError(t('plugins.invalidValue'))
      return
    }

    try {
      await Promise.all(writes)
      setInfo(t('plugins.saved'))
      // Clear touched so the next save round only writes new edits.
      setState((prev) => ({ ...prev, touched: {}, invalid: {} }))
      scheduleCacheInvalidation()
    } catch (err) {
      console.error('[plugin] save failed', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="max-w-2xl space-y-5 rounded-md border p-4">
      <div>
        <h2 className="text-base font-semibold">
          {displayName ? resolveLocalized(displayName, locale) : instanceId}
        </h2>
        <p className="text-xs text-muted-foreground">{instanceId}</p>
      </div>

      {fields.map((field) => (
        <FieldRow
          key={field.key}
          field={field}
          value={state.values[field.key] ?? ''}
          invalid={!!state.invalid[field.key]}
          onChange={(v) => update(field.key, v)}
          onReset={() => void reset(field)}
          hasStoredValue={Object.prototype.hasOwnProperty.call(
            initialValues,
            field.key
          )}
        />
      ))}

      {info && <p className="text-sm text-muted-foreground">{info}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={saving}>
        {saving ? t('plugins.saving') : t('plugins.save')}
      </Button>
    </form>
  )
}

interface FieldRowProps {
  field: PluginSettingField
  value: string
  invalid: boolean
  onChange: (v: string) => void
  onReset: () => void
  hasStoredValue: boolean
}

function FieldRow({ field, value, invalid, onChange, onReset, hasStoredValue }: FieldRowProps) {
  const t = useT()
  const locale = useLocale()
  const id = `plugin-${field.key}`

  const labelEl = (
    <Label htmlFor={id} className={invalid ? 'text-destructive' : undefined}>
      {resolveLocalized(field.label, locale)}
      {field.required && <span className="ml-1 text-destructive">*</span>}
    </Label>
  )
  const description = field.description ? (
    <p className="text-xs text-muted-foreground">{resolveLocalized(field.description, locale)}</p>
  ) : null

  const input = renderInput(field, id, value, invalid, onChange)
  const placeholder = renderDefaultHint(field, locale)

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        {labelEl}
        {hasStoredValue && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={onReset}
          >
            {t('plugins.resetToDefault')}
          </button>
        )}
      </div>
      {description}
      {input}
      {placeholder}
    </div>
  )
}

function renderDefaultHint(field: PluginSettingField, _locale: string): React.ReactNode {
  if (field.default === undefined) return null
  let preview: string
  if (typeof field.default === 'string') preview = field.default
  else if (typeof field.default === 'boolean' || typeof field.default === 'number') {
    preview = String(field.default)
  } else {
    try {
      preview = JSON.stringify(field.default)
    } catch {
      return null
    }
  }
  if (!preview) return null
  return (
    <p className="text-xs text-muted-foreground">
      <code>{preview}</code>
    </p>
  )
}

function renderInput(
  field: PluginSettingField,
  id: string,
  value: string,
  invalid: boolean,
  onChange: (v: string) => void
): React.ReactNode {
  switch (field.type) {
    case 'text':
    case 'url':
      return (
        <Input
          id={id}
          value={value}
          maxLength={field.type === 'text' ? field.maxLength : undefined}
          placeholder={'placeholder' in field ? field.placeholder : undefined}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
          type={field.type === 'url' ? 'url' : 'text'}
        />
      )
    case 'textarea':
      return (
        <Textarea
          id={id}
          value={value}
          rows={field.rows ?? 4}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
        />
      )
    case 'code':
      return (
        <div className="space-y-1">
          {field.language && (
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {field.language}
            </p>
          )}
          <Textarea
            id={id}
            value={value}
            rows={field.rows ?? 8}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={invalid}
            className="font-mono text-xs"
          />
        </div>
      )
    case 'boolean':
      return (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="checkbox"
            checked={value === 'true'}
            onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
            className="h-4 w-4"
          />
          <span className="text-xs text-muted-foreground">
            {value === 'true' ? 'on' : 'off'}
          </span>
        </div>
      )
    case 'number':
      return (
        <Input
          id={id}
          type="number"
          value={value}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
        />
      )
    case 'select':
      return (
        <select
          id={id}
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
        >
          <option value="">—</option>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {typeof opt.label === 'string' ? opt.label : opt.value}
            </option>
          ))}
        </select>
      )
    case 'json':
      return (
        <Textarea
          id={id}
          value={value}
          rows={field.rows ?? 8}
          placeholder={field.placeholder ?? '{}'}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
          className="font-mono text-xs"
        />
      )
  }
}
