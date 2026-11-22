import { describe, it, expect, vi } from 'vitest'
import { loadEditorThemeClasses } from './theme-classes.js'

const manifest = {
  name: 'blog',
  label: 'Blog',
  fields: [],
  customClasses: [
    { id: 'compact', label: { en: 'Compact', ja: 'コンパクト' }, description: { en: 'Tight cells', ja: '詰めたセル' }, target: 'table' },
    { id: 'Bad Id', label: 'x', target: 'table' },
    { id: 'wide', label: { en: 'Wide', ja: 'ワイド' }, target: 'post' },
    { id: 'serif', label: 'Serif', description: 'Serif body text', target: 'post' },
  ],
}

describe('loadEditorThemeClasses', () => {
  it('resolves labels for the admin locale, splits by target and drops invalid ids', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const loadThemeConfig = vi.fn(async () => ({ manifest }))
    const out = await loadEditorThemeClasses({ locale: 'ja', loadThemeConfig })
    expect(out).toEqual({
      tableClasses: [{ id: 'compact', label: 'コンパクト', description: '詰めたセル' }],
      postClasses: [
        { id: 'wide', label: 'ワイド' },
        { id: 'serif', label: 'Serif', description: 'Serif body text' },
      ],
    })
    // One manifest read serves both lists.
    expect(loadThemeConfig).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('returns empty lists for callers without loadThemeConfig', async () => {
    expect(await loadEditorThemeClasses(undefined)).toEqual({ tableClasses: [], postClasses: [] })
    expect(await loadEditorThemeClasses({})).toEqual({ tableClasses: [], postClasses: [] })
  })

  it('logs and returns empty lists when the theme cannot be loaded', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await loadEditorThemeClasses({
      locale: 'en',
      loadThemeConfig: async () => {
        throw new Error('S3 down')
      },
    })
    expect(out).toEqual({ tableClasses: [], postClasses: [] })
    expect(err).toHaveBeenCalledOnce()
    err.mockRestore()
  })
})
