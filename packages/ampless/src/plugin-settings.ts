// Validation + resolution helpers for `AmplessPlugin.settings.public`
// (Phase 2). Mirrors the shape of `theme.ts`'s
// `validateThemeValue` / `resolveThemeValues` so admin save and
// runtime read paths use the same code.
//
// Storage convention: every saved field lives at
//   pk = 'siteconfig'
//   sk = `plugins.<instanceId>.<fieldKey>`
//
// The dotted separator forces both `instanceId` and `fieldKey` to
// avoid `.`. Without that, splitting the SK back into its components
// in the trusted processor / admin form would be ambiguous. We also
// reject `@` / `/` / whitespace to keep the storage keys safe to
// embed in URLs and log lines.

import type {
  PluginSettingField,
  PluginSettingsManifest,
} from './plugin.js'

// `instanceId` (chosen by plugin authors / cms.config.ts) and field
// `key` (declared by the plugin manifest) share this pattern. Length
// is not capped here — the AppSync row key field has its own limits
// and a misuse would have surfaced as a write error long before any
// runtime lookup.
export const PLUGIN_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/

export function isValidPluginKey(key: string): boolean {
  return typeof key === 'string' && PLUGIN_KEY_PATTERN.test(key)
}

/**
 * Validate one raw value against a field definition. Returns the
 * (possibly-coerced) value on success, or `null` to signal rejection.
 *
 * Semantics:
 *   - **string-like fields** (text / textarea / url / code) accept
 *     `''` as valid when `required` is falsy. This is the "disable"
 *     sentinel — e.g. `pattern: '^$|^G-...'` lets a GA4 plugin save
 *     an empty measurementId to suppress the loader without dropping
 *     the row.
 *   - **non-string-like fields** (number / boolean / json / select)
 *     always reject `''`. Allowing it would force callers to handle a
 *     `string` reading where `number | undefined` is declared. To
 *     "unset" these fields, delete the row (admin form's "Reset to
 *     default" button).
 *   - `undefined` is treated as "not set" by `resolvePluginSettings`
 *     — `validatePluginSettingValue` itself returns `null` for it.
 *   - Constraints (`pattern`, `min`, `max`, `maxLength`, `options`) run
 *     only when the value is present and non-empty.
 *
 * The returned shape preserves the declared type — `text` stores a
 * sanitized string, `number` stores a `number`, `boolean` stores a
 * `boolean`, `json` stores the decoded value (object / array /
 * primitive — never the source string), etc.
 */
export function validatePluginSettingValue(
  field: PluginSettingField,
  raw: unknown
): unknown | null {
  if (raw === undefined) return null

  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'code': {
      if (typeof raw !== 'string') return null
      // Strip control chars + angle brackets (matches theme.ts text
      // sanitization). Plugin scripts that need them go through the
      // descriptor surface, not here.
      const sanitized = raw.replace(/[\x00-\x1f<>]/g, '')
      if (sanitized === '') {
        return field.required ? null : ''
      }
      const maxLength =
        (field.type === 'text' && field.maxLength) ||
        (field.type === 'textarea' && field.maxLength) ||
        (field.type === 'code' && field.maxLength) ||
        undefined
      if (typeof maxLength === 'number' && sanitized.length > maxLength) {
        return null
      }
      if (field.type === 'text' && field.pattern) {
        let re: RegExp
        try {
          re = new RegExp(field.pattern)
        } catch {
          return null
        }
        if (!re.test(sanitized)) return null
      }
      return sanitized
    }

    case 'url': {
      if (typeof raw !== 'string') return null
      const trimmed = raw.trim()
      if (trimmed === '') {
        return field.required ? null : ''
      }
      // Same scheme denylist as plugin-head's `isSafeUrl`. We reject
      // anything that the browser would treat as a script execution
      // vector. The descriptor renderer applies the same check again
      // before emitting, but rejecting at write time gives admins a
      // useful form error instead of a silent drop later.
      if (/^\s*(javascript|vbscript|data|blob|file):/i.test(trimmed)) {
        return null
      }
      const allowRelative = field.allowRelative !== false
      const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)
      if (schemeMatch) {
        const scheme = schemeMatch[1]!.toLowerCase()
        if (scheme !== 'http' && scheme !== 'https') return null
      } else if (!allowRelative) {
        return null
      }
      return trimmed
    }

    case 'boolean': {
      if (typeof raw === 'boolean') return raw
      // Forgive admin form payloads that serialize through JSON as
      // strings or numbers. Anything else (object, array, undefined,
      // null) is a programming error.
      if (raw === 'true' || raw === 1) return true
      if (raw === 'false' || raw === 0) return false
      return null
    }

    case 'number': {
      if (typeof raw === 'number') {
        if (Number.isNaN(raw)) return null
      } else if (typeof raw === 'string') {
        const trimmed = raw.trim()
        if (trimmed === '') return null
        const n = Number(trimmed)
        if (Number.isNaN(n)) return null
        raw = n
      } else {
        return null
      }
      const n = raw as number
      if (typeof field.min === 'number' && n < field.min) return null
      if (typeof field.max === 'number' && n > field.max) return null
      return n
    }

    case 'select': {
      if (typeof raw !== 'string') return null
      if (raw === '') return null
      if (!field.options.some((opt) => opt.value === raw)) return null
      return raw
    }

    case 'json': {
      if (raw === '') return null
      // Accept already-decoded values (object / array / primitive) so
      // the same validator works for both admin form submissions
      // (JSON.parse'd on the way in) and runtime reads from
      // DynamoDB / S3 (already decoded). Strings that look like JSON
      // are not implicitly parsed — admin form does the parse before
      // calling this.
      if (typeof raw === 'string') return null
      return raw
    }
  }
}

/**
 * Merge stored values on top of manifest defaults for one plugin
 * instance. Both sides are validated through `validatePluginSettingValue`
 * — stored values that fail validation (manual DDB tampering, schema
 * drift) fall back to the validated default; defaults that themselves
 * fail validation surface as `undefined`.
 *
 * `stored` is a flat key → value map keyed by the field's `key` (not
 * the full DDB SK). The runtime extracts it from the site-settings
 * snapshot using the `plugins.<instanceId>.` prefix.
 *
 * Validation runs on the default too because the default can come
 * from a plugin's constructor argument (e.g. GA4 takes a
 * `measurementId` option and passes it through as the field's
 * `default`). If the operator supplies a bogus value at install time
 * we'd rather surface `undefined` than render garbage.
 */
export function resolvePluginSettings(
  manifest: PluginSettingsManifest | undefined,
  stored: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const fields = manifest?.public
  if (!fields) return out

  for (const field of fields) {
    if (!isValidPluginKey(field.key)) {
      // Caller (runtime / admin normalization) is responsible for
      // warning. Skip silently here to keep the helper allocation-
      // light when called per request.
      continue
    }

    let resolved: unknown = undefined
    if (Object.prototype.hasOwnProperty.call(stored, field.key)) {
      const validated = validatePluginSettingValue(field, stored[field.key])
      if (validated !== null) resolved = validated
    }
    if (resolved === undefined && field.default !== undefined) {
      const validatedDefault = validatePluginSettingValue(field, field.default)
      if (validatedDefault !== null) resolved = validatedDefault
    }
    if (resolved !== undefined) {
      out[field.key] = resolved
    }
  }
  return out
}
