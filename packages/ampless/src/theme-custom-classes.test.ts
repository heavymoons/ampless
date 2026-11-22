import { describe, it, expect, vi } from 'vitest'
import {
  isValidCustomClassId,
  normalizePostClasses,
  postBodyClassName,
  postCustomClassName,
  tableCustomClassName,
  themeCustomClasses,
  themePostClasses,
  themeTableClasses,
  type ThemeManifest,
} from './theme.js'

describe('theme custom classes', () => {
  it('isValidCustomClassId accepts lowercase / digits / hyphens only', () => {
    for (const ok of ['compact', 'rank-2col', 'a', '9', 'a'.repeat(64)]) expect(isValidCustomClassId(ok)).toBe(true)
    for (const bad of ['', 'Compact', 'a b', 'a_b', 'x"y', '<x>', 'a'.repeat(65), 1, null, undefined, ['a']])
      expect(isValidCustomClassId(bad)).toBe(false)
  })

  it('tableCustomClassName prefixes the base table class', () => {
    expect(tableCustomClassName('compact')).toBe('tiptap-table--compact')
  })

  it('themeTableClasses keeps valid table entries, first id wins, ignores other targets', () => {
    const manifest = {
      name: 't',
      customClasses: [
        { id: 'compact', label: 'Compact', target: 'table' },
        { id: 'Bad Id', label: 'x', target: 'table' },
        { id: 'compact', label: 'Duplicate', target: 'table' },
        { id: 'striped', label: { en: 'Striped', ja: 'ストライプ' }, target: 'table' },
        { id: 'post-only', label: 'x', target: 'post' },
      ],
    } as unknown as ThemeManifest
    const out = themeTableClasses(manifest)
    expect(out.map((c) => c.id)).toEqual(['compact', 'striped'])
    expect(out[0]!.label).toBe('Compact')
  })

  it('themeTableClasses returns [] when the manifest declares none', () => {
    expect(themeTableClasses({ name: 't' })).toEqual([])
  })

  it('themePostClasses keeps valid post entries only; themeCustomClasses filters by target', () => {
    const manifest = {
      name: 't',
      customClasses: [
        { id: 'compact', label: 'Compact', target: 'table' },
        { id: 'wide', label: 'Wide', target: 'post' },
        { id: 'Bad', label: 'x', target: 'post' },
        { id: 'wide', label: 'Duplicate', target: 'post' },
        { id: 'serif', label: 'Serif', target: 'post' },
      ],
    } as unknown as ThemeManifest
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(themePostClasses(manifest).map((c) => c.id)).toEqual(['wide', 'serif'])
    expect(themeCustomClasses(manifest, 'table').map((c) => c.id)).toEqual(['compact'])
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('postCustomClassName prefixes ampless-post--', () => {
    expect(postCustomClassName('wide')).toBe('ampless-post--wide')
  })

  it('normalizePostClasses accepts arrays only, drops invalid ids, de-dupes in order', () => {
    for (const notArray of [undefined, null, 'wide', 1, { 0: 'wide' }]) expect(normalizePostClasses(notArray)).toEqual([])
    expect(normalizePostClasses(['serif', 'wide', 'serif', 'Bad', 3, null, 'x" onmouseover=', 'wide'])).toEqual([
      'serif',
      'wide',
    ])
  })

  it('postBodyClassName returns base unchanged without classes and appends otherwise', () => {
    expect(postBodyClassName(undefined, 'prose')).toBe('prose')
    expect(postBodyClassName(null)).toBe('')
    expect(postBodyClassName({ postClasses: [] }, 'prose max-w-none')).toBe('prose max-w-none')
    expect(postBodyClassName({ postClasses: ['<x>'] }, 'prose')).toBe('prose')
    expect(postBodyClassName({ postClasses: ['wide', 'serif'] }, 'prose')).toBe(
      'prose ampless-post--wide ampless-post--serif',
    )
    expect(postBodyClassName({ postClasses: ['wide'] })).toBe('ampless-post--wide')
  })
})
