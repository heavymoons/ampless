import { describe, it, expect } from 'vitest'
import { translate, resolveLocale, getDictionary } from './i18n.js'

describe('admin i18n', () => {
  it('resolves built-in locale codes', () => {
    const en = resolveLocale('en')
    expect(en.locale).toBe('en')
    expect(en.dict.sidebar.brand).toBeDefined()

    const ja = resolveLocale('ja')
    expect(ja.locale).toBe('ja')
  })

  it('falls back to en when locale code is unknown', () => {
    const out = resolveLocale('zz')
    expect(out.locale).toBe('en')
  })

  it('accepts an object literal as a custom dictionary', () => {
    // Cast through `as any` is fine for tests — production callers pass a
    // structurally complete Dictionary; this exercises the lookup walk
    // against a sparse object that mimics a user-provided override.
    const custom = { sidebar: { brand: 'Custom Brand' } } as unknown as Parameters<
      typeof resolveLocale
    >[0]
    const out = resolveLocale(custom)
    expect((out.dict as unknown as { sidebar: { brand: string } }).sidebar.brand).toBe(
      'Custom Brand'
    )
  })

  it('translates a dotted key', () => {
    const dict = getDictionary('en')
    expect(translate(dict, 'sidebar.dashboard')).toBe('Dashboard')
  })

  it('substitutes {var} placeholders', () => {
    const dict = getDictionary('en')
    const out = translate(dict, 'posts.form.deleteConfirm', { title: 'Hello' })
    expect(out).toContain('"Hello"')
  })

  it('falls back to English then the key when missing', () => {
    const dict = getDictionary('en')
    const out = translate(dict, 'nonexistent.key')
    expect(out).toBe('nonexistent.key')
  })

  it('falls back from a partial custom dictionary to English', () => {
    const custom = resolveLocale({
      sidebar: { brand: 'X' },
    } as unknown as Parameters<typeof resolveLocale>[0]).dict
    expect(translate(custom, 'sidebar.dashboard')).toBe('Dashboard')
  })
})
