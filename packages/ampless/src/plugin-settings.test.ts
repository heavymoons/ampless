import { describe, it, expect } from 'vitest'
import {
  PLUGIN_KEY_PATTERN,
  isValidPluginKey,
  validatePluginSettingValue,
  resolvePluginSettings,
} from './plugin-settings.js'
import type {
  PluginSettingField,
  PluginSettingsManifest,
} from './plugin.js'

describe('isValidPluginKey', () => {
  it('accepts alphanumeric, underscore, hyphen', () => {
    expect(isValidPluginKey('foo')).toBe(true)
    expect(isValidPluginKey('Foo123')).toBe(true)
    expect(isValidPluginKey('foo_bar')).toBe(true)
    expect(isValidPluginKey('foo-bar')).toBe(true)
    expect(isValidPluginKey('A1_b-2')).toBe(true)
  })

  it('rejects dot-separated keys (would break sk parsing)', () => {
    expect(isValidPluginKey('foo.bar')).toBe(false)
  })

  it('rejects scope / path / whitespace characters', () => {
    expect(isValidPluginKey('@scope/name')).toBe(false)
    expect(isValidPluginKey('foo bar')).toBe(false)
    expect(isValidPluginKey('foo/bar')).toBe(false)
    expect(isValidPluginKey('foo:bar')).toBe(false)
    expect(isValidPluginKey('')).toBe(false)
  })

  it('PLUGIN_KEY_PATTERN matches isValidPluginKey', () => {
    expect(PLUGIN_KEY_PATTERN.test('ok-key_1')).toBe(true)
    expect(PLUGIN_KEY_PATTERN.test('bad.key')).toBe(false)
  })
})

describe('validatePluginSettingValue — text/textarea/code', () => {
  const textField: PluginSettingField = {
    type: 'text',
    key: 'mid',
    label: 'measurement id',
    pattern: '^$|^G-[A-Z0-9]+$',
  }

  it('accepts empty string on optional string fields (disable semantics)', () => {
    expect(validatePluginSettingValue(textField, '')).toBe('')
  })

  it('rejects empty string when required: true', () => {
    const required: PluginSettingField = { ...textField, required: true }
    expect(validatePluginSettingValue(required, '')).toBe(null)
  })

  it('returns null for undefined', () => {
    expect(validatePluginSettingValue(textField, undefined)).toBe(null)
  })

  it('applies pattern only when non-empty', () => {
    expect(validatePluginSettingValue(textField, 'G-ABC123')).toBe('G-ABC123')
    expect(validatePluginSettingValue(textField, 'g-lower')).toBe(null)
    expect(validatePluginSettingValue(textField, 'GAfoo')).toBe(null)
  })

  it('rejects non-string input', () => {
    expect(validatePluginSettingValue(textField, 42)).toBe(null)
    expect(validatePluginSettingValue(textField, true)).toBe(null)
    expect(validatePluginSettingValue(textField, null)).toBe(null)
  })

  it('strips control chars and angle brackets', () => {
    const field: PluginSettingField = { type: 'text', key: 'k', label: 'k' }
    expect(validatePluginSettingValue(field, 'safe <b>tag')).toBe('safe btag')
  })

  it('respects maxLength', () => {
    const field: PluginSettingField = {
      type: 'text',
      key: 'k',
      label: 'k',
      maxLength: 5,
    }
    expect(validatePluginSettingValue(field, 'short')).toBe('short')
    expect(validatePluginSettingValue(field, 'longer')).toBe(null)
  })

  it('textarea allows multi-line text but not control chars beyond newlines', () => {
    const field: PluginSettingField = {
      type: 'textarea',
      key: 'k',
      label: 'k',
    }
    // Note: \n is 0x0a, which is in our 0x00..0x1f strip range. The
    // intention is to strip them — plugin authors that need
    // multiline should use `code` or escape on the publicHead side.
    expect(validatePluginSettingValue(field, 'line1')).toBe('line1')
  })
})

describe('validatePluginSettingValue — url', () => {
  const urlField: PluginSettingField = {
    type: 'url',
    key: 'endpoint',
    label: 'endpoint',
  }

  it('accepts http(s) URLs', () => {
    expect(validatePluginSettingValue(urlField, 'https://example.com')).toBe(
      'https://example.com'
    )
    expect(validatePluginSettingValue(urlField, 'http://localhost:3000')).toBe(
      'http://localhost:3000'
    )
  })

  it('accepts relative paths by default', () => {
    expect(validatePluginSettingValue(urlField, '/path')).toBe('/path')
    expect(validatePluginSettingValue(urlField, './rel')).toBe('./rel')
  })

  it('rejects relative when allowRelative=false', () => {
    const f: PluginSettingField = { ...urlField, allowRelative: false }
    expect(validatePluginSettingValue(f, '/path')).toBe(null)
  })

  it('rejects dangerous schemes', () => {
    expect(validatePluginSettingValue(urlField, 'javascript:alert(1)')).toBe(null)
    expect(validatePluginSettingValue(urlField, 'data:text/html,x')).toBe(null)
    expect(validatePluginSettingValue(urlField, 'vbscript:x')).toBe(null)
    expect(validatePluginSettingValue(urlField, 'file:///etc/passwd')).toBe(null)
  })

  it('empty string ok unless required', () => {
    expect(validatePluginSettingValue(urlField, '')).toBe('')
    const required: PluginSettingField = { ...urlField, required: true }
    expect(validatePluginSettingValue(required, '')).toBe(null)
  })
})

describe('validatePluginSettingValue — number', () => {
  const field: PluginSettingField = {
    type: 'number',
    key: 'count',
    label: 'count',
    min: 1,
    max: 100,
  }

  it('accepts numbers in range', () => {
    expect(validatePluginSettingValue(field, 5)).toBe(5)
  })

  it('coerces numeric strings', () => {
    expect(validatePluginSettingValue(field, '42')).toBe(42)
  })

  it('rejects empty string (no string-empty fallback for non-string types)', () => {
    expect(validatePluginSettingValue(field, '')).toBe(null)
  })

  it('rejects out-of-range', () => {
    expect(validatePluginSettingValue(field, 0)).toBe(null)
    expect(validatePluginSettingValue(field, 101)).toBe(null)
  })

  it('rejects NaN', () => {
    expect(validatePluginSettingValue(field, Number.NaN)).toBe(null)
    expect(validatePluginSettingValue(field, 'not a number')).toBe(null)
  })
})

describe('validatePluginSettingValue — boolean', () => {
  const field: PluginSettingField = {
    type: 'boolean',
    key: 'enabled',
    label: 'enabled',
  }

  it('accepts true/false', () => {
    expect(validatePluginSettingValue(field, true)).toBe(true)
    expect(validatePluginSettingValue(field, false)).toBe(false)
  })

  it('coerces "true"/"false" strings + 0/1', () => {
    expect(validatePluginSettingValue(field, 'true')).toBe(true)
    expect(validatePluginSettingValue(field, 'false')).toBe(false)
    expect(validatePluginSettingValue(field, 1)).toBe(true)
    expect(validatePluginSettingValue(field, 0)).toBe(false)
  })

  it('rejects empty string and unknown shapes', () => {
    expect(validatePluginSettingValue(field, '')).toBe(null)
    expect(validatePluginSettingValue(field, 'yes')).toBe(null)
    expect(validatePluginSettingValue(field, {})).toBe(null)
  })
})

describe('validatePluginSettingValue — select', () => {
  const field: PluginSettingField = {
    type: 'select',
    key: 'mode',
    label: 'mode',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
  }

  it('accepts listed options', () => {
    expect(validatePluginSettingValue(field, 'a')).toBe('a')
  })

  it('rejects unknown options', () => {
    expect(validatePluginSettingValue(field, 'c')).toBe(null)
  })

  it('rejects empty string', () => {
    expect(validatePluginSettingValue(field, '')).toBe(null)
  })
})

describe('validatePluginSettingValue — json', () => {
  const field: PluginSettingField = {
    type: 'json',
    key: 'config',
    label: 'config',
  }

  it('accepts already-decoded objects and arrays', () => {
    expect(validatePluginSettingValue(field, { x: 1 })).toEqual({ x: 1 })
    expect(validatePluginSettingValue(field, [1, 2])).toEqual([1, 2])
  })

  it('accepts primitives that are not strings', () => {
    expect(validatePluginSettingValue(field, 42)).toBe(42)
    expect(validatePluginSettingValue(field, true)).toBe(true)
  })

  it('rejects raw strings (admin form is expected to JSON.parse first)', () => {
    expect(validatePluginSettingValue(field, '{"x":1}')).toBe(null)
  })

  it('rejects empty string', () => {
    expect(validatePluginSettingValue(field, '')).toBe(null)
  })
})

describe('resolvePluginSettings', () => {
  const manifest: PluginSettingsManifest = {
    public: [
      {
        type: 'text',
        key: 'measurementId',
        label: 'mid',
        pattern: '^$|^G-[A-Z0-9]+$',
        default: 'G-DEFAULT',
      },
      {
        type: 'boolean',
        key: 'enabled',
        label: 'enabled',
        default: true,
      },
      {
        type: 'number',
        key: 'sampleRate',
        label: 'rate',
        min: 0,
        max: 100,
        default: 50,
      },
    ],
  }

  it('falls back to default when no stored value', () => {
    expect(resolvePluginSettings(manifest, {})).toEqual({
      measurementId: 'G-DEFAULT',
      enabled: true,
      sampleRate: 50,
    })
  })

  it('stored value wins over default', () => {
    expect(
      resolvePluginSettings(manifest, {
        measurementId: 'G-OTHER',
        sampleRate: 10,
      })
    ).toEqual({
      measurementId: 'G-OTHER',
      enabled: true,
      sampleRate: 10,
    })
  })

  it('empty string stored value overrides default for string fields', () => {
    // Critical: GA4 admin disables GA by saving empty string. The
    // stored '' must not fall back to the constructor's
    // `G-DEFAULT`.
    expect(
      resolvePluginSettings(manifest, { measurementId: '' })
    ).toMatchObject({ measurementId: '' })
  })

  it('invalid stored value falls back to default', () => {
    expect(
      resolvePluginSettings(manifest, { measurementId: 'not-a-ga4-id' })
    ).toMatchObject({ measurementId: 'G-DEFAULT' })
  })

  it('invalid default surfaces as undefined for that key', () => {
    const bad: PluginSettingsManifest = {
      public: [
        {
          type: 'text',
          key: 'k',
          label: 'k',
          pattern: '^X-[A-Z]+$',
          default: 'bogus' as unknown as string,
        },
      ],
    }
    expect(resolvePluginSettings(bad, {})).toEqual({})
  })

  it('returns empty object when manifest is undefined', () => {
    expect(resolvePluginSettings(undefined, { x: 1 })).toEqual({})
  })

  it('skips fields with invalid keys silently', () => {
    const m: PluginSettingsManifest = {
      public: [
        { type: 'text', key: 'bad.key', label: 'b', default: 'v' },
        { type: 'text', key: 'good', label: 'g', default: 'ok' },
      ],
    }
    expect(resolvePluginSettings(m, {})).toEqual({ good: 'ok' })
  })
})
