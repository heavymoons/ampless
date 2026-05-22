'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  setSiteSetting,
  deleteSiteSetting,
  themeSettingKey,
  validateThemeValue,
  resolveLocalized,
  parseLinkList,
  stringifyLinkList,
  parseColorPair,
  formatColorPair,
  type ThemeManifest,
  type ThemeField,
  type LocalizedString,
  type LinkListItem,
} from 'ampless'
import {
  COLOR_SCHEME_SETTING_KEY,
  DEFAULT_COLOR_SCHEME,
  validateColorScheme,
  type ColorScheme,
} from '@ampless/runtime'
import { Button, Input, Label } from '@ampless/runtime/ui'
import { invalidateSiteSettingsCache } from '../lib/theme-actions.js'
import { useT, useLocale } from './i18n-provider.js'

// How long to wait after a switch / save before forcing a hard reload
// to pick up the rebuilt S3 cache. The trusted processor typically
// finishes rebuilding `public/site-settings.json` within 5-10 seconds
// of the KvStore write; this gives that pipeline some slack before we
// re-fetch.
const CACHE_REBUILD_DELAY_MS = 8000

interface ThemeOption {
  value: string
  label: LocalizedString
  description?: LocalizedString
}

interface Props {
  manifest: ThemeManifest
  activeTheme: string
  themeOptions: ThemeOption[]
  /** Resolved values currently shown to the user (overrides ?? defaults). */
  initial: Record<string, string>
  /**
   * Site-wide color-scheme override loaded from the runtime. Independent
   * of the manifest (it's a site-wide concern, not theme-specific).
   * Defaults to `'auto'` when not provided.
   */
  initialColorScheme?: ColorScheme
}

interface ChangeState {
  /** Field key → user-entered raw value (string). Empty means cleared. */
  values: Record<string, string>
  /** Field key → true if user has touched this field this session. */
  touched: Record<string, boolean>
}

export function ThemeSettingsForm({
  manifest,
  activeTheme,
  themeOptions,
  initial,
  initialColorScheme,
}: Props) {
  const router = useRouter()
  const t = useT()
  const locale = useLocale()
  const [state, setState] = useState<ChangeState>({ values: initial, touched: {} })
  const [pendingTheme, setPendingTheme] = useState<string>(activeTheme)
  // Local view of which theme is "active" — updated optimistically as
  // soon as a switch saves, so the indicator reflects the user's
  // action without waiting for the S3 cache rebuild + Next.js cache
  // invalidation roundtrip.
  const [optimisticActive, setOptimisticActive] = useState<string>(activeTheme)
  const [saving, setSaving] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [invalid, setInvalid] = useState<Record<string, boolean>>({})
  // Site-wide color-scheme override. Persisted under a fixed KvStore
  // key (`theme.colorScheme`) independent of the manifest field set —
  // every theme inherits this setting because both light and dark
  // palettes ship with the theme's `tokens.css`.
  const [colorScheme, setColorScheme] = useState<ColorScheme>(
    initialColorScheme ?? DEFAULT_COLOR_SCHEME
  )
  const [colorSchemeTouched, setColorSchemeTouched] = useState(false)

  function update(key: string, value: string) {
    setState((prev) => ({
      values: { ...prev.values, [key]: value },
      touched: { ...prev.touched, [key]: true },
    }))
  }

  // After a write the public-site fetch cache (60s TTL) needs to be
  // invalidated so the next visit gets fresh data. The trusted
  // processor takes ~5-10s to rebuild the S3 JSON, so we delay the
  // invalidation a bit before firing it.
  //
  // We do NOT reload the admin page in the background here — the form
  // already shows what the user typed, and re-reading from S3 right
  // after save can race with the rebuild and surface a stale empty
  // form. Theme switching uses a separate hard-reload path because
  // the manifest schema itself changes.
  function scheduleCacheInvalidation() {
    setTimeout(async () => {
      try {
        await invalidateSiteSettingsCache()
      } catch (err) {
        console.warn('[theme] cache invalidation failed', err)
      }
    }, CACHE_REBUILD_DELAY_MS)
  }

  function scheduleHardReload() {
    setTimeout(async () => {
      try {
        await invalidateSiteSettingsCache()
      } catch (err) {
        console.warn('[theme] cache invalidation failed', err)
      }
      window.location.reload()
    }, CACHE_REBUILD_DELAY_MS)
  }

  async function switchTheme(e: React.FormEvent) {
    e.preventDefault()
    if (pendingTheme === optimisticActive) return
    setSwitching(true)
    setError(null)
    setInfo(null)
    try {
      await setSiteSetting('theme.active', pendingTheme)
      setOptimisticActive(pendingTheme)
      setInfo(t('theme.switched', { theme: pendingTheme }))
      scheduleHardReload()
    } catch (err) {
      console.error('[theme] switch failed', err)
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
        writes.push(deleteSiteSetting(storeKey))
        continue
      }

      const validated = validateThemeValue(field, raw)
      if (validated === null) {
        newInvalid[field.key] = true
        continue
      }
      writes.push(setSiteSetting(storeKey, validated))
    }

    // Color-scheme is independent of the manifest. Persist under a
    // fixed key; 'auto' (default) wipes the override so the site falls
    // back to following the visitor's system `prefers-color-scheme`.
    if (colorSchemeTouched) {
      if (colorScheme === DEFAULT_COLOR_SCHEME) {
        writes.push(deleteSiteSetting(COLOR_SCHEME_SETTING_KEY))
      } else {
        writes.push(setSiteSetting(COLOR_SCHEME_SETTING_KEY, colorScheme))
      }
    }

    if (Object.keys(newInvalid).length > 0) {
      setInvalid(newInvalid)
      setSaving(false)
      setError(t('theme.invalidValues'))
      return
    }

    try {
      await Promise.all(writes)
      setInfo(t('theme.saved'))
      // Clear touched flags so the next save round only writes new edits.
      setState((prev) => ({ values: prev.values, touched: {} }))
      setColorSchemeTouched(false)
      // Invalidate the public-site cache in the background so visitors
      // see the change soon. We intentionally don't reload the admin
      // page here — the form already reflects what the user typed,
      // and re-reading from S3 immediately after save can race with
      // the trusted processor's rebuild and show stale data.
      scheduleCacheInvalidation()
    } catch (err) {
      console.error('[theme] save failed', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const groups = groupFields(manifest.fields)

  return (
    <div className="space-y-8">
      {/* Theme switcher — separate form so changing the active theme
          triggers a refresh that re-renders this page with the new
          theme's manifest fields. */}
      <form onSubmit={switchTheme} className="max-w-xl space-y-3 rounded-md border p-4">
        <div className="space-y-1">
          <Label htmlFor="active-theme" className="text-sm font-medium">
            {t('theme.activeLabel')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t('theme.currentlyActive', { theme: optimisticActive })}
            {optimisticActive !== activeTheme && t('theme.propagating')}
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
              {resolveLocalized(opt.label, locale)} ({opt.value})
            </option>
          ))}
        </select>
        {(() => {
          const desc = themeOptions.find((o) => o.value === pendingTheme)?.description
          return desc ? (
            <p className="text-xs text-muted-foreground">{resolveLocalized(desc, locale)}</p>
          ) : null
        })()}
        <Button
          type="submit"
          disabled={switching || pendingTheme === optimisticActive}
          variant={pendingTheme === optimisticActive ? 'outline' : 'default'}
        >
          {switching ? t('theme.switching') : t('theme.switchButton')}
        </Button>
      </form>

      {/* Live iframe preview. Hits the public home with
          `?previewTheme=<pendingTheme>&previewColorScheme=<mode>` so
          the user sees the unsaved theme + color-scheme combination
          without committing. Reflects whatever values are currently
          saved in S3 — unsaved manifest edits still require Save
          before showing here.
          The iframe `key` includes both pending selections so React
          remounts (and the iframe reloads) whenever either changes. */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">{t('theme.previewLabel')}</Label>
        <iframe
          key={`${pendingTheme}-${colorScheme}`}
          src={`/?previewTheme=${encodeURIComponent(pendingTheme)}&previewColorScheme=${encodeURIComponent(colorScheme)}`}
          title={t('theme.previewLabel')}
          className="h-[600px] w-full rounded-md border bg-[var(--background)]"
        />
        <p className="text-xs text-muted-foreground">{t('theme.previewHint')}</p>
      </div>

      {/* Manifest fields for the currently active theme. */}
      <form onSubmit={save} className="max-w-xl space-y-6">
        <div>
          <h2 className="text-lg font-semibold">
            {t('theme.customizationHeading', {
              theme: resolveLocalized(manifest.label, locale),
            })}
          </h2>
          {manifest.description && (
            <p className="text-sm text-muted-foreground">
              {resolveLocalized(manifest.description, locale)}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {t('theme.customizationHint')}
          </p>
        </div>

        <fieldset className="space-y-2">
          <Label htmlFor="color-scheme" className="text-sm font-medium">
            {t('theme.colorScheme.label')}
          </Label>
          <select
            id="color-scheme"
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={colorScheme}
            onChange={(e) => {
              setColorScheme(validateColorScheme(e.target.value))
              setColorSchemeTouched(true)
            }}
          >
            <option value="auto">{t('theme.colorScheme.auto')}</option>
            <option value="light">{t('theme.colorScheme.light')}</option>
            <option value="dark">{t('theme.colorScheme.dark')}</option>
          </select>
          <p className="text-xs text-muted-foreground">{t('theme.colorScheme.hint')}</p>
        </fieldset>

        {groups.map(({ key, name, fields }) => (
          <fieldset key={key} className="space-y-4">
            <legend className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {resolveLocalized(name, locale)}
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
          {saving ? t('theme.saving') : t('theme.saveButton')}
        </Button>
      </form>
    </div>
  )
}

// Group fields by their `group` property (a LocalizedString or string).
// We bucket by JSON-stringified key so multilingual maps with the same
// content end up in the same bucket regardless of locale; the rendered
// label is resolved per-locale at display time.
function groupFields(
  fields: ReadonlyArray<ThemeField>
): Array<{ key: string; name: LocalizedString; fields: ThemeField[] }> {
  const map = new Map<string, { name: LocalizedString; fields: ThemeField[] }>()
  for (const field of fields) {
    const g: LocalizedString = field.group ?? 'General'
    const k = typeof g === 'string' ? g : JSON.stringify(g)
    const existing = map.get(k)
    if (existing) {
      existing.fields.push(field)
    } else {
      map.set(k, { name: g, fields: [field] })
    }
  }
  return Array.from(map.entries()).map(([key, { name, fields }]) => ({ key, name, fields }))
}

interface FieldRowProps {
  field: ThemeField
  value: string
  invalid: boolean
  onChange: (v: string) => void
}

function FieldRow({ field, value, invalid, onChange }: FieldRowProps) {
  const t = useT()
  const locale = useLocale()
  const id = `theme-${field.key}`
  // Manifest labels / descriptions can be plain strings or per-locale
  // maps; `resolveLocalized` picks the right form for the active locale
  // (falling back to English, then to any value).
  const labelEl = (
    <Label htmlFor={id} className={invalid ? 'text-destructive' : undefined}>
      {resolveLocalized(field.label, locale)}
    </Label>
  )
  const description = field.description ? (
    <p className="text-xs text-muted-foreground">
      {resolveLocalized(field.description, locale)}
    </p>
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
          <p className="text-xs text-muted-foreground">{t('theme.lengthHelp')}</p>
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
            <option value="">{t('common.default')}</option>
            {field.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {resolveLocalized(opt.label, locale)}
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
            placeholder={field.default || t('theme.imagePlaceholder')}
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
    case 'linkList':
      return (
        <LinkListField
          field={field}
          labelEl={labelEl}
          description={description}
          value={value}
          onChange={onChange}
        />
      )
  }
}

interface LinkListFieldProps {
  field: ThemeField & { type: 'linkList' }
  labelEl: React.ReactNode
  description: React.ReactNode
  value: string
  onChange: (v: string) => void
}

/**
 * Repeatable rows of (label, url) pairs, plus add / remove / move-up /
 * move-down buttons. Saves a JSON-stringified array on every edit, so
 * the form's existing save() round trip stores it verbatim.
 *
 * URLs prefixed with `tag:<name>` are rendered with a hint that the
 * theme will expand them into a post list — encourages discoverability
 * of the docs-style sidebar pattern.
 */
function LinkListField({ field, labelEl, description, value, onChange }: LinkListFieldProps) {
  const items: LinkListItem[] = parseLinkList(value)
  const max = field.maxItems ?? 50

  function commit(next: LinkListItem[]) {
    onChange(stringifyLinkList(next))
  }

  function update(idx: number, patch: Partial<LinkListItem>) {
    commit(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  function add() {
    if (items.length >= max) return
    commit([...items, { label: '', url: '' }])
  }

  function remove(idx: number) {
    commit(items.filter((_, i) => i !== idx))
  }

  function move(idx: number, delta: -1 | 1) {
    const target = idx + delta
    if (target < 0 || target >= items.length) return
    const next = items.slice()
    const [moved] = next.splice(idx, 1)
    next.splice(target, 0, moved!)
    commit(next)
  }

  return (
    <div className="space-y-2">
      {labelEl}
      {description}
      <div className="space-y-2 rounded-md border bg-muted/20 p-3">
        {items.length === 0 && (
          <p className="text-xs text-muted-foreground">No links yet.</p>
        )}
        {items.map((item, idx) => {
          const isTagRef = /^tag:/.test(item.url.trim())
          return (
            <div key={idx} className="flex flex-wrap items-start gap-2">
              <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                <Input
                  value={item.label}
                  placeholder="Label"
                  onChange={(e) => update(idx, { label: e.target.value })}
                />
                <Input
                  value={item.url}
                  placeholder="/path or https://… or tag:name"
                  onChange={(e) => update(idx, { url: e.target.value })}
                  className={isTagRef ? 'font-mono text-xs' : undefined}
                />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  aria-label="Move up"
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => move(idx, 1)}
                  disabled={idx === items.length - 1}
                  aria-label="Move down"
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(idx)}
                  aria-label="Remove"
                >
                  ×
                </Button>
              </div>
            </div>
          )
        })}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          disabled={items.length >= max}
        >
          + Add link
        </Button>
        <p className="text-xs text-muted-foreground">
          Tip: use <code>tag:&lt;name&gt;</code> as a URL to render a list
          of posts with that tag instead of a single link.
        </p>
      </div>
    </div>
  )
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
 * Color field with optional light / dark pair input.
 *
 * Single color (the common case) is rendered as one row of
 * [swatch + text input]. Toggling "Add dark variant" expands a second
 * row for the dark-mode value; when filled, the stored value becomes
 * `light-dark(L, D)` (a Baseline-2024 CSS function that the runtime
 * pastes verbatim into `:root { --foo: <value> }` — the browser
 * selects between the two per active `color-scheme`).
 *
 * Storage form:
 *   - No dark variant → `value` is a bare CSS color
 *   - Dark variant set → `value` is `light-dark(L, D)`
 *
 * The swatch is a native `<input type="color">`. It only understands
 * `#rrggbb`, so the picker's `value` is computed from the typed CSS
 * color (oklch / hsl / named / …) via the browser's CSS engine in a
 * `useEffect` — that way hydration starts with a stable default and
 * the picker updates to the actual color once the DOM is ready.
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
  // Decode the stored value into separate light / dark components so
  // the form can edit them independently. Empty `value` means "use the
  // manifest default" — we leave both inputs blank but show the
  // default in the placeholder.
  const parsed = parseColorPair(value)
  const lightInput = parsed.dark !== null ? parsed.light : value
  const darkInput = parsed.dark ?? ''
  const [showDark, setShowDark] = useState(parsed.dark !== null)

  function emit(nextLight: string, nextDark: string) {
    if (!nextDark.trim()) {
      onChange(nextLight)
      return
    }
    onChange(formatColorPair(nextLight || field.default, nextDark))
  }

  const lightEffective = lightInput || field.default
  // Resolve the dark side too so the dark swatch shows the right color
  // even when the user is editing the dark input first. Empty dark
  // input → show the light value so the swatch isn't black.
  const darkEffective = darkInput || lightEffective

  return (
    <div className="space-y-2">
      {labelEl}
      {description}
      <ColorRow
        id={id}
        label={showDark ? 'Light' : undefined}
        value={lightInput}
        effective={lightEffective}
        placeholder={field.default}
        ariaLabel={`${typeof field.label === 'string' ? field.label : id} (light)`}
        invalid={invalid}
        onChange={(v) => emit(v, darkInput)}
      />
      {showDark ? (
        <ColorRow
          id={`${id}-dark`}
          label="Dark"
          value={darkInput}
          effective={darkEffective}
          placeholder={lightEffective}
          ariaLabel={`${typeof field.label === 'string' ? field.label : id} (dark)`}
          invalid={invalid}
          onChange={(v) => emit(lightInput, v)}
        />
      ) : null}
      <div className="flex items-center gap-3 text-xs">
        <button
          type="button"
          className="text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => {
            if (showDark) {
              // Collapsing the dark row clears the dark variant so the
              // stored value falls back to single-form on next save.
              setShowDark(false)
              emit(lightInput, '')
            } else {
              setShowDark(true)
            }
          }}
        >
          {showDark ? '− Remove dark variant' : '+ Add dark variant (optional)'}
        </button>
      </div>
    </div>
  )
}

interface ColorRowProps {
  id: string
  label?: string
  value: string
  effective: string
  placeholder: string
  ariaLabel: string
  invalid: boolean
  onChange: (v: string) => void
}

function ColorRow({
  id,
  label,
  value,
  effective,
  placeholder,
  ariaLabel,
  invalid,
  onChange,
}: ColorRowProps) {
  const hex = useColorAsHex(effective)
  return (
    <div className="space-y-1">
      {label ? (
        <Label htmlFor={id} className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </Label>
      ) : null}
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded border border-input bg-background p-0"
          aria-label={`${ariaLabel} swatch`}
        />
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
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
 * `#rrggbb` for the native color picker.
 *
 * Uses `getComputedStyle` round-tripping via a hidden DOM element —
 * works for every color form the browser can render (broader than the
 * canvas fillStyle approach we used before, and survives SSR
 * hydration because we initialise in `useState` then update in
 * `useEffect`).
 *
 * The hidden element is appended to `<body>` only after mount; on the
 * server (and during initial render before hydration completes) we
 * return a hex fallback parsed from the literal `#rrggbb` form when
 * possible, else `#000000`. The picker then updates once the effect
 * runs.
 */
function useColorAsHex(value: string): string {
  const [hex, setHex] = useState<string>(() => directHex(value) ?? '#000000')
  useEffect(() => {
    const direct = directHex(value)
    if (direct) {
      setHex(direct)
      return
    }
    if (typeof document === 'undefined') return
    try {
      const el = document.createElement('span')
      el.style.color = value
      el.style.display = 'none'
      document.body.appendChild(el)
      const computed = getComputedStyle(el).color
      document.body.removeChild(el)
      const next = rgbStringToHex(computed)
      if (next) setHex(next)
    } catch {
      // leave hex unchanged
    }
  }, [value])
  return hex
}

function directHex(value: string): string | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(value.trim())
  return m ? value.trim().toLowerCase() : null
}

function rgbStringToHex(rgb: string): string | null {
  // Accept `rgb(r, g, b)` and `rgba(r, g, b, a)` — modern browsers may
  // also emit `rgb(r g b)` (space-separated, no commas) for some
  // colour spaces, so allow either separator.
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(rgb)
  if (!m) return null
  const r = clampToHex(m[1]!)
  const g = clampToHex(m[2]!)
  const b = clampToHex(m[3]!)
  return `#${r}${g}${b}`
}

function clampToHex(s: string): string {
  const n = Math.max(0, Math.min(255, parseInt(s, 10)))
  return n.toString(16).padStart(2, '0')
}
