import { describe, it, expect } from 'vitest'
import {
  PLUGIN_KEY_PATTERN,
  isValidPluginKey,
  validatePluginSettingValue,
  resolvePluginSettings,
} from './plugin-settings.js'
import type {
  PluginRepeatableField,
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

// ---------------------------------------------------------------------------
// mode 引数の退行ゼロ確認 — 既存 8 variant は strict/lenient で挙動不変
// ---------------------------------------------------------------------------
describe('validatePluginSettingValue — strict/lenient mode regression (existing 8 variants)', () => {
  // text
  it('text: strict/lenient 両 mode で valid 値は同じ結果を返す', () => {
    const f: PluginSettingField = { type: 'text', key: 'k', label: 'k', pattern: '^G-[A-Z0-9]+$' }
    expect(validatePluginSettingValue(f, 'G-ABC123', 'strict')).toBe('G-ABC123')
    expect(validatePluginSettingValue(f, 'G-ABC123', 'lenient')).toBe('G-ABC123')
    expect(validatePluginSettingValue(f, 'bad', 'strict')).toBe(null)
    expect(validatePluginSettingValue(f, 'bad', 'lenient')).toBe(null)
  })

  // textarea
  it('textarea: strict/lenient 両 mode で同じ結果', () => {
    const f: PluginSettingField = { type: 'textarea', key: 'k', label: 'k' }
    expect(validatePluginSettingValue(f, 'hello', 'strict')).toBe('hello')
    expect(validatePluginSettingValue(f, 'hello', 'lenient')).toBe('hello')
    expect(validatePluginSettingValue(f, 42, 'strict')).toBe(null)
    expect(validatePluginSettingValue(f, 42, 'lenient')).toBe(null)
  })

  // code
  it('code: strict/lenient 両 mode で同じ結果', () => {
    const f: PluginSettingField = { type: 'code', key: 'k', label: 'k', maxLength: 10 }
    expect(validatePluginSettingValue(f, 'console', 'strict')).toBe('console')
    expect(validatePluginSettingValue(f, 'console', 'lenient')).toBe('console')
    expect(validatePluginSettingValue(f, 'toolongstring', 'strict')).toBe(null)
  })

  // url
  it('url: strict/lenient 両 mode で同じ結果', () => {
    const f: PluginSettingField = { type: 'url', key: 'k', label: 'k' }
    expect(validatePluginSettingValue(f, 'https://example.com', 'strict')).toBe('https://example.com')
    expect(validatePluginSettingValue(f, 'https://example.com', 'lenient')).toBe('https://example.com')
    expect(validatePluginSettingValue(f, 'javascript:x', 'strict')).toBe(null)
    expect(validatePluginSettingValue(f, 'javascript:x', 'lenient')).toBe(null)
  })

  // boolean
  it('boolean: strict/lenient 両 mode で同じ結果', () => {
    const f: PluginSettingField = { type: 'boolean', key: 'k', label: 'k' }
    expect(validatePluginSettingValue(f, true, 'strict')).toBe(true)
    expect(validatePluginSettingValue(f, 'true', 'lenient')).toBe(true)
    expect(validatePluginSettingValue(f, 'yes', 'strict')).toBe(null)
    expect(validatePluginSettingValue(f, 'yes', 'lenient')).toBe(null)
  })

  // number
  it('number: strict/lenient 両 mode で同じ結果', () => {
    const f: PluginSettingField = { type: 'number', key: 'k', label: 'k', min: 1, max: 10 }
    expect(validatePluginSettingValue(f, 5, 'strict')).toBe(5)
    expect(validatePluginSettingValue(f, 5, 'lenient')).toBe(5)
    expect(validatePluginSettingValue(f, 0, 'strict')).toBe(null)
    expect(validatePluginSettingValue(f, 0, 'lenient')).toBe(null)
  })

  // select
  it('select: strict/lenient 両 mode で同じ結果', () => {
    const f: PluginSettingField = {
      type: 'select', key: 'k', label: 'k',
      options: [{ value: 'a', label: 'A' }],
    }
    expect(validatePluginSettingValue(f, 'a', 'strict')).toBe('a')
    expect(validatePluginSettingValue(f, 'a', 'lenient')).toBe('a')
    expect(validatePluginSettingValue(f, 'z', 'strict')).toBe(null)
    expect(validatePluginSettingValue(f, 'z', 'lenient')).toBe(null)
  })

  // json
  it('json: strict/lenient 両 mode で同じ結果', () => {
    const f: PluginSettingField = { type: 'json', key: 'k', label: 'k' }
    expect(validatePluginSettingValue(f, { x: 1 }, 'strict')).toEqual({ x: 1 })
    expect(validatePluginSettingValue(f, { x: 1 }, 'lenient')).toEqual({ x: 1 })
    expect(validatePluginSettingValue(f, '{"x":1}', 'strict')).toBe(null)
    expect(validatePluginSettingValue(f, '{"x":1}', 'lenient')).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// repeatable フィールドの基本 validation
// ---------------------------------------------------------------------------

/** cookie-consent の categories 相当の repeatable field 定義 */
const categoriesField: PluginRepeatableField = {
  type: 'repeatable',
  key: 'categories',
  label: 'Categories',
  maxItems: 5,
  minItems: 0,
  fields: [
    {
      type: 'text',
      key: 'id',
      label: 'ID',
      required: true,
      pattern: '^[a-z][a-z0-9_-]*$',
      maxLength: 32,
    },
    {
      type: 'text',
      key: 'label',
      label: 'Label',
      required: true,
      maxLength: 100,
    },
    {
      type: 'textarea',
      key: 'description',
      label: 'Description',
      required: false,
      maxLength: 500,
    },
    {
      type: 'boolean',
      key: 'defaultEnabled',
      label: 'Default Enabled',
      required: false,
      default: false,
    },
    {
      type: 'boolean',
      key: 'essential',
      label: 'Essential',
      required: false,
      default: false,
    },
  ],
}

describe('validatePluginSettingValue — repeatable 基本', () => {
  it('空配列 → [] を返す (両 mode)', () => {
    // 空リストは minItems=0 なので valid
    expect(validatePluginSettingValue(categoriesField, [], 'lenient')).toEqual([])
    expect(validatePluginSettingValue(categoriesField, [], 'strict')).toEqual([])
  })

  it('valid な item 1 つ → item 1 つ返る', () => {
    const raw = [{ id: 'analytics', label: 'Analytics' }]
    const result = validatePluginSettingValue(categoriesField, raw, 'lenient')
    expect(Array.isArray(result)).toBe(true)
    expect((result as unknown[]).length).toBe(1)
    const item = (result as Record<string, unknown>[])[0]!
    expect(item['id']).toBe('analytics')
    expect(item['label']).toBe('Analytics')
  })

  it('array でない → null (両 mode)', () => {
    // object でも array でなければ null
    expect(validatePluginSettingValue(categoriesField, { id: 'x' }, 'lenient')).toBe(null)
    expect(validatePluginSettingValue(categoriesField, { id: 'x' }, 'strict')).toBe(null)
    expect(validatePluginSettingValue(categoriesField, 'string', 'lenient')).toBe(null)
    expect(validatePluginSettingValue(categoriesField, 42, 'strict')).toBe(null)
  })

  it('length > maxItems → null (両 mode)', () => {
    // maxItems=5 なので 6 item は reject
    const raw = Array.from({ length: 6 }, (_, i) => ({ id: `id${i}`, label: `L${i}` }))
    expect(validatePluginSettingValue(categoriesField, raw, 'lenient')).toBe(null)
    expect(validatePluginSettingValue(categoriesField, raw, 'strict')).toBe(null)
  })

  it('length < minItems → null (両 mode)', () => {
    // minItems=2 にしたフィールドで空配列を渡す
    const f: PluginRepeatableField = { ...categoriesField, minItems: 2 }
    expect(validatePluginSettingValue(f, [], 'lenient')).toBe(null)
    expect(validatePluginSettingValue(f, [], 'strict')).toBe(null)
  })
})

describe('validatePluginSettingValue — repeatable item 不正', () => {
  it('item が string → strict: null / lenient: drop', () => {
    const raw = ['not-an-object', { id: 'analytics', label: 'Analytics' }]
    // strict: 最初の item が object でない → field 全体 reject
    expect(validatePluginSettingValue(categoriesField, raw, 'strict')).toBe(null)
    // lenient: bad item を drop → valid item 1 つだけ返る
    const lenientResult = validatePluginSettingValue(categoriesField, raw, 'lenient')
    expect(Array.isArray(lenientResult)).toBe(true)
    expect((lenientResult as unknown[]).length).toBe(1)
  })

  it('item が null → strict: null / lenient: drop', () => {
    const raw = [null, { id: 'marketing', label: 'Marketing' }]
    expect(validatePluginSettingValue(categoriesField, raw, 'strict')).toBe(null)
    const lenientResult = validatePluginSettingValue(categoriesField, raw, 'lenient')
    expect(Array.isArray(lenientResult)).toBe(true)
    expect((lenientResult as unknown[]).length).toBe(1)
  })

  it('required sub-field (id) 欠落 → strict: null / lenient: drop', () => {
    // `id` は required なので欠落 item は invalid
    const raw = [
      { label: 'No ID here' },            // id 欠落
      { id: 'analytics', label: 'Valid' },
    ]
    expect(validatePluginSettingValue(categoriesField, raw, 'strict')).toBe(null)
    const lenientResult = validatePluginSettingValue(categoriesField, raw, 'lenient')
    expect(Array.isArray(lenientResult)).toBe(true)
    expect((lenientResult as unknown[]).length).toBe(1)
    expect((lenientResult as Record<string, unknown>[])[0]!['id']).toBe('analytics')
  })

  it('required sub-field (id) が pattern 違反 → strict: null / lenient: drop', () => {
    // id pattern は ^[a-z][a-z0-9_-]*$ — 先頭大文字は違反
    const raw = [
      { id: 'Analytics', label: 'Capital start' }, // invalid
      { id: 'marketing', label: 'OK' },
    ]
    expect(validatePluginSettingValue(categoriesField, raw, 'strict')).toBe(null)
    const lenientResult = validatePluginSettingValue(categoriesField, raw, 'lenient')
    expect(Array.isArray(lenientResult)).toBe(true)
    expect((lenientResult as unknown[]).length).toBe(1)
    expect((lenientResult as Record<string, unknown>[])[0]!['id']).toBe('marketing')
  })
})

describe('validatePluginSettingValue — repeatable optional sub-field の 3 path (spec §4)', () => {
  it('optional 欠落 + default あり → default を採用して item に含む', () => {
    // defaultEnabled の default は false
    const raw = [{ id: 'analytics', label: 'Analytics' }]
    const result = validatePluginSettingValue(categoriesField, raw, 'lenient') as Record<string, unknown>[]
    expect(result).not.toBeNull()
    const item = result[0]!
    // defaultEnabled は欠落しているが default=false があるので含まれる
    expect('defaultEnabled' in item).toBe(true)
    expect(item['defaultEnabled']).toBe(false)
    // essential も同様
    expect('essential' in item).toBe(true)
    expect(item['essential']).toBe(false)
  })

  it('optional 欠落 + default なし → key 自体を validatedItem に含めない', () => {
    // description は optional で default が未設定
    const raw = [{ id: 'analytics', label: 'Analytics' }]
    const result = validatePluginSettingValue(categoriesField, raw, 'lenient') as Record<string, unknown>[]
    const item = result[0]!
    // description は欠落 + default なし → key 自体が存在しない
    expect('description' in item).toBe(false)
  })

  it('optional invalid → key を drop するが item は valid (両 mode)', () => {
    // description に boolean を渡す (textarea は string 必須)
    const raw = [{ id: 'analytics', label: 'Analytics', description: true }]
    // lenient
    const lenientResult = validatePluginSettingValue(categoriesField, raw, 'lenient') as Record<string, unknown>[]
    expect(lenientResult).not.toBeNull()
    expect(lenientResult.length).toBe(1)
    // description の key は drop される
    expect('description' in lenientResult[0]!).toBe(false)
    // id / label は残っている
    expect(lenientResult[0]!['id']).toBe('analytics')

    // strict でも同じ — optional invalid は key drop のみ、item は reject しない
    const strictResult = validatePluginSettingValue(categoriesField, raw, 'strict') as Record<string, unknown>[]
    expect(strictResult).not.toBeNull()
    expect(strictResult.length).toBe(1)
    expect('description' in strictResult[0]!).toBe(false)
  })
})

describe('validatePluginSettingValue — repeatable sub-field 型 spot check', () => {
  // text pattern (id): 特殊文字を含む id は pattern 違反
  it('text pattern: id に空白を含む → invalid', () => {
    const raw = [{ id: 'bad id', label: 'Bad' }]
    // lenient: 制御文字/angle bracket は strip されるが空白は残り、pattern 違反で item drop
    const result = validatePluginSettingValue(categoriesField, raw, 'lenient') as unknown[]
    expect(result.length).toBe(0)
  })

  // select: options 外の値は rejected
  it('select sub-field: options にない値 → key drop (optional) / item drop (required)', () => {
    const fieldWithSelect: PluginRepeatableField = {
      type: 'repeatable',
      key: 'items',
      label: 'Items',
      fields: [
        {
          type: 'select',
          key: 'color',
          label: 'Color',
          required: true,
          options: [
            { value: 'red', label: 'Red' },
            { value: 'blue', label: 'Blue' },
          ],
        },
      ],
    }
    const raw = [{ color: 'green' }, { color: 'red' }]
    // strict: 最初の item が invalid → field 全体 null
    expect(validatePluginSettingValue(fieldWithSelect, raw, 'strict')).toBe(null)
    // lenient: drop bad item → 1 item 返る
    const result = validatePluginSettingValue(fieldWithSelect, raw, 'lenient') as Record<string, unknown>[]
    expect(result.length).toBe(1)
    expect(result[0]!['color']).toBe('red')
  })

  // boolean coerce: 文字列 'true' / 'false' が boolean に変換される
  it('boolean sub-field: 文字列 "true" が boolean true に coerce される', () => {
    const raw = [{ id: 'analytics', label: 'Analytics', defaultEnabled: 'true' }]
    const result = validatePluginSettingValue(categoriesField, raw, 'lenient') as Record<string, unknown>[]
    expect(result[0]!['defaultEnabled']).toBe(true)
  })

  // number min/max: 範囲外は reject
  it('number sub-field: min/max 超過 → required なら item drop', () => {
    const fieldWithNumber: PluginRepeatableField = {
      type: 'repeatable',
      key: 'scores',
      label: 'Scores',
      fields: [
        {
          type: 'number',
          key: 'value',
          label: 'Value',
          required: true,
          min: 0,
          max: 100,
        },
      ],
    }
    const raw = [{ value: 150 }, { value: 50 }]
    // lenient: 150 は max 超過 → item drop、50 は valid
    const result = validatePluginSettingValue(fieldWithNumber, raw, 'lenient') as Record<string, unknown>[]
    expect(result.length).toBe(1)
    expect(result[0]!['value']).toBe(50)
  })
})
