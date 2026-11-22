import { describe, it, expect } from 'vitest'
import {
  isValidCustomClassId,
  tableCustomClassName,
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
})
