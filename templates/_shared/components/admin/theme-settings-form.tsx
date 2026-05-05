'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  setSiteSetting,
  deleteSiteSetting,
  themeSettingKey,
  validateThemeValue,
  resolveLocalized,
  parseLinkList,
  stringifyLinkList,
  type ThemeManifest,
  type ThemeField,
  type LocalizedString,
  type LinkListItem,
} from 'ampless'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { invalidateSiteSettingsCache } from '@/lib/theme-actions'
import { useT, useLocale } from '@/components/i18n-provider'

// How long to wait after a switch / save before forcing a hard reload
// to pick up the rebuilt S3 cache. The trusted processor typically
// finishes rebuilding `public/site-settings/{siteId}.json` within
// 5-10 seconds of the KvStore write; this gives that pipeline some
// slack before we re-fetch.
const CACHE_REBUILD_DELAY_MS = 8000

interface ThemeOption {
  value: string
  label: LocalizedString
  description?: LocalizedString
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
        await invalidateSiteSettingsCache(siteId)
      } catch (err) {
        console.warn('[theme] cache invalidation failed', err)
      }
    }, CACHE_REBUILD_DELAY_MS)
  }

  function scheduleHardReload() {
    setTimeout(async () => {
      try {
        await invalidateSiteSettingsCache(siteId)
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
      await setSiteSetting(siteId, 'theme.active', pendingTheme)
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
      setError(t('theme.invalidValues'))
      return
    }

    try {
      await Promise.all(writes)
      setInfo(t('theme.saved'))
      // Clear touched flags so the next save round only writes new edits.
      setState((prev) => ({ values: prev.values, touched: {} }))
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
          `?previewTheme=<pendingTheme>` so the user sees the chosen
          theme without committing the switch. Reflects whatever
          values are currently saved in S3 — unsaved manifest edits
          require Save before showing here. */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">{t('theme.previewLabel')}</Label>
        <iframe
          key={pendingTheme}
          src={`/?previewTheme=${encodeURIComponent(pendingTheme)}`}
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
