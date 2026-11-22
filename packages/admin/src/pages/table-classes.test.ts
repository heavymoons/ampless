import { describe, it, expect, vi } from 'vitest'
import { loadEditorTableClasses } from './table-classes.js'

const manifest = {
  name: 'blog',
  label: 'Blog',
  fields: [],
  customClasses: [
    { id: 'compact', label: { en: 'Compact', ja: 'コンパクト' }, description: { en: 'Tight cells', ja: '詰めたセル' }, target: 'table' },
    { id: 'Bad Id', label: 'x', target: 'table' },
  ],
}

describe('loadEditorTableClasses', () => {
  it('resolves labels for the admin locale and drops invalid ids', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await loadEditorTableClasses({ locale: 'ja', loadThemeConfig: async () => ({ manifest }) })
    expect(out).toEqual([{ id: 'compact', label: 'コンパクト', description: '詰めたセル' }])
    warn.mockRestore()
  })

  it('returns [] for callers without loadThemeConfig', async () => {
    expect(await loadEditorTableClasses(undefined)).toEqual([])
    expect(await loadEditorTableClasses({})).toEqual([])
  })

  it('logs and returns [] when the theme cannot be loaded', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await loadEditorTableClasses({
      locale: 'en',
      loadThemeConfig: async () => {
        throw new Error('S3 down')
      },
    })
    expect(out).toEqual([])
    expect(err).toHaveBeenCalledOnce()
    err.mockRestore()
  })
})
