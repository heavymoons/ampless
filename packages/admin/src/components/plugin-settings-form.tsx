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

import { useState, useEffect } from 'react'
import {
  resolveLocalized,
  type LocalizedString,
  type PluginSettingField,
  type PluginSecretField,
  type PluginRepeatableField,
} from 'ampless'
import { Button, Input, Label, Textarea } from '@ampless/runtime/ui'
import {
  setPluginPublicSetting,
  deletePluginPublicSetting,
  getPluginPublicSetting,
  collectSettingWrites,
} from '../lib/plugin-settings.js'
import {
  setPluginSecret,
  clearPluginSecret,
  hasPluginSecret,
} from '../lib/plugin-secret.js'
import { invalidateSiteSettingsCache } from '../lib/theme-actions.js'
import { useT, useLocale } from './i18n-provider.js'
import { RepeatableFieldEditor } from './repeatable-field-editor.js'
import { SecretFieldInput } from './secret-field-input.js'

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
  /**
   * Secret fields declared in `settings.secret`. Rendered below the
   * public fields in a visually distinct section. Values are NEVER
   * fetched — each SecretFieldInput independently checks existence via
   * `hasPluginSecret()` at mount time.
   */
  secretFields?: ReadonlyArray<PluginSecretField>
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
    case 'repeatable':
      // The RepeatableFieldEditor contract: value prop is a JSON string
      // of the item array. Stored values are already typed arrays.
      if (typeof raw === 'string') return raw
      try {
        return JSON.stringify(raw)
      } catch {
        return '[]'
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
    case 'repeatable': {
      // `raw` is the JSON-serialized array produced by
      // RepeatableFieldEditor's onChange. Parse it back into the typed
      // array before handing off to validatePluginSettingValue(strict).
      const trimmed = raw.trim()
      if (trimmed === '') return []
      try {
        const parsed: unknown = JSON.parse(trimmed)
        return Array.isArray(parsed) ? parsed : null
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
  secretFields,
}: Props) {
  const t = useT()
  const locale = useLocale()

  // Track which secret fields have a stored value (existence-check only;
  // value is never returned). Loaded once at mount via hasPluginSecret().
  //
  // `null` = check has not completed yet. We use this to gate the render
  // of `<SecretFieldInput>` because that component initializes its
  // useReducer state from the `hasValue` prop ONCE on mount — if we
  // rendered with `hasValue={false}` first and then changed to `true`
  // after the async check completes, the reducer state would stay
  // `'unset'` forever and the masked Replace UI would never appear,
  // even though the DDB row clearly exists. (This was the final
  // dogfood-blocking bug on `ishinao.net` after PR #210 made the
  // AppSync read itself work.)
  const [secretHasValue, setSecretHasValue] = useState<Record<
    string,
    boolean
  > | null>(null)

  useEffect(() => {
    if (!secretFields || secretFields.length === 0) {
      setSecretHasValue({})
      return
    }
    let cancelled = false
    async function check() {
      const results: Record<string, boolean> = {}
      for (const field of secretFields!) {
        try {
          results[field.key] = await hasPluginSecret(instanceId, field.key)
        } catch {
          results[field.key] = false
        }
      }
      if (!cancelled) setSecretHasValue(results)
    }
    void check()
    return () => {
      cancelled = true
    }
  // Only run on mount / instanceId change; secretFields is stable from manifest
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId])

  // Mount-time refresh: read public-field values directly from DDB (KvStore,
  // strongly consistent) to bypass the S3 snapshot lag (~60 s). This mirrors
  // the secretHasValue check above. Only non-touched fields are updated so
  // in-flight edits are never clobbered.
  useEffect(() => {
    if (fields.length === 0) return
    let cancelled = false
    async function fetchStoredValues() {
      const updates: Record<string, string> = {}
      const newStoredKeys: string[] = []
      for (const field of fields) {
        try {
          const stored = await getPluginPublicSetting(instanceId, field.key)
          if (stored !== null && stored !== undefined) {
            updates[field.key] = stringify(field, stored)
            newStoredKeys.push(field.key)
          }
        } catch (err) {
          console.warn('[plugin] mount fetch failed for field', field.key, err)
        }
      }
      if (cancelled) return
      if (Object.keys(updates).length > 0) {
        setState((prev) => {
          const nextValues = { ...prev.values }
          for (const [key, val] of Object.entries(updates)) {
            // Never overwrite a field the user is currently editing
            if (!prev.touched[key]) {
              nextValues[key] = val
            }
          }
          return { ...prev, values: nextValues }
        })
        setStoredKeys((prev) => {
          const next = new Set(prev)
          for (const k of newStoredKeys) next.add(k)
          return next
        })
      }
    }
    void fetchStoredValues()
    return () => {
      cancelled = true
    }
  // Only run on mount / instanceId change; fields is stable from manifest
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId])

  // Display value priority: stored DDB value → manifest.default →
  // empty string. Showing the default in the input box (when no
  // stored row exists) makes it obvious what the public runtime is
  // currently using, and surfaces e.g. GA4's "empty = disable"
  // semantics — the user can see the `G-...` ID their constructor
  // injected and intentionally blank it. The default value remains
  // a *display* default only: `storedKeys` stays empty, so Reset is
  // hidden and a touched-then-saved field is what triggers a write.
  function defaultDisplay(field: PluginSettingField): string {
    return field.default !== undefined ? stringify(field, field.default) : ''
  }
  const [state, setState] = useState<FormState>(() => {
    const values: Record<string, string> = {}
    for (const field of fields) {
      const has = Object.prototype.hasOwnProperty.call(initialValues, field.key)
      values[field.key] = has
        ? stringify(field, initialValues[field.key])
        : defaultDisplay(field)
    }
    return { values, touched: {}, invalid: {} }
  })
  // Tracks which fields currently have an explicit DDB row. Drives
  // the "Reset to default" button visibility: shown iff the field has
  // a stored value. Updated on save (add) / reset (remove) so the UI
  // matches reality without remounting the form.
  const [storedKeys, setStoredKeys] = useState<Set<string>>(
    () => new Set(Object.keys(initialValues))
  )
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
      // Restore the manifest default in the input so the user sees
      // what the public runtime is now using. Clear `touched` for
      // this field so the next save() doesn't re-write it.
      setState((prev) => ({
        values: { ...prev.values, [field.key]: defaultDisplay(field) },
        touched: { ...prev.touched, [field.key]: false },
        invalid: { ...prev.invalid, [field.key]: false },
      }))
      setStoredKeys((prev) => {
        if (!prev.has(field.key)) return prev
        const next = new Set(prev)
        next.delete(field.key)
        return next
      })
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

    const { writes: pendingWrites, invalid: newInvalid } = collectSettingWrites(
      fields,
      state.values,
      state.touched,
      parse
    )

    if (Object.keys(newInvalid).length > 0) {
      setState((prev) => ({ ...prev, invalid: newInvalid }))
      setSaving(false)
      setError(t('plugins.invalidValue'))
      return
    }

    // Honest no-op: nothing touched or all touched fields were skipped
    // (empty non-string fields that can't be "saved empty"). Tell the user
    // so they don't think a server round-trip happened.
    if (pendingWrites.length === 0) {
      setInfo(t('plugins.noChanges'))
      setSaving(false)
      return
    }

    try {
      await Promise.all(
        pendingWrites.map(({ field, parsed }) =>
          setPluginPublicSetting(instanceId, field, parsed)
        )
      )
      const writtenKeys = pendingWrites.map(({ field }) => field.key)
      setInfo(t('plugins.saved'))
      // Remove only the keys that were actually written from `touched`.
      // Un-written touched fields (e.g. empty non-string fields that were
      // skipped by the null-parse path) must stay touched so the next save
      // can attempt them again — the old wholesale `touched: {}` reset was
      // silently dropping those edits.
      setState((prev) => {
        const nextTouched = { ...prev.touched }
        for (const k of writtenKeys) delete nextTouched[k]
        return { ...prev, touched: nextTouched, invalid: {} }
      })
      setStoredKeys((prev) => {
        const next = new Set(prev)
        for (const k of writtenKeys) next.add(k)
        return next
      })
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

      {fields.length > 0 && (
        <>
          {fields.map((field) => (
            <FieldRow
              key={field.key}
              field={field}
              value={state.values[field.key] ?? ''}
              invalid={!!state.invalid[field.key]}
              onChange={(v) => update(field.key, v)}
              onReset={() => void reset(field)}
              hasStoredValue={storedKeys.has(field.key)}
            />
          ))}

          {info && <p className="text-sm text-muted-foreground">{info}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" disabled={saving}>
            {saving ? t('plugins.saving') : t('plugins.save')}
          </Button>
        </>
      )}

      {/* Secret settings section — visually separated, below public fields */}
      {secretFields && secretFields.length > 0 && (
        <div className="mt-6 space-y-4 border-t pt-4">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-amber-700 dark:text-amber-400">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="h-3.5 w-3.5"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a2 2 0 0 0-2 2v4.5A2.5 2.5 0 0 0 4.5 15h7a2.5 2.5 0 0 0 2.5-2.5V8a2 2 0 0 0-2-2h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 5V4.5a2 2 0 1 0-4 0V6h4Z"
                  clipRule="evenodd"
                />
              </svg>
              Secret settings
            </h3>
            <p className="text-xs text-muted-foreground">
              Values are stored securely and never displayed after saving. They are only
              accessible by the trusted processor Lambda — not by the public site or admin UI.
            </p>
          </div>
          {secretHasValue === null ? (
            // Loading placeholder. Keep layout height stable so the
            // section doesn't jump when the check resolves.
            <div
              className="h-10 animate-pulse rounded-md bg-muted/50"
              aria-busy="true"
              aria-label={t('plugins.loading')}
            />
          ) : (
            secretFields.map((field) => (
              <SecretFieldInput
                key={field.key}
                field={field}
                hasValue={secretHasValue[field.key] ?? false}
                onSave={(value) => setPluginSecret(field, instanceId, value)}
                onClear={() => clearPluginSecret(instanceId, field.key)}
              />
            ))
          )}
        </div>
      )}
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

/**
 * Render a scalar (non-repeatable) plugin field input. Handles the 8
 * scalar variant types: text, url, textarea, code, boolean, number,
 * select, json. Factored out of `renderInput` so the repeatable case
 * can call back into it per sub-field cell without interleaving with
 * the repeatable branch.
 */
export function renderScalarInput(
  field: Exclude<PluginSettingField, PluginRepeatableField>,
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

function renderInput(
  field: PluginSettingField,
  id: string,
  value: string,
  invalid: boolean,
  onChange: (v: string) => void
): React.ReactNode {
  switch (field.type) {
    case 'repeatable':
      return (
        <RepeatableFieldEditor
          field={field}
          id={id}
          value={value}
          invalid={invalid}
          onChange={onChange}
        />
      )
    default:
      return renderScalarInput(field, id, value, invalid, onChange)
  }
}
