import { describe, it, expect, vi } from 'vitest'
import { loadEditorPostClasses } from './post-classes.js'

const manifest = {
  name: 'blog',
  label: 'Blog',
  fields: [],
  customClasses: [
    { id: 'wide', label: { en: 'Wide', ja: 'ワイド' }, description: { en: 'Full width', ja: '全幅' }, target: 'post' },
    { id: 'compact', label: 'Compact', target: 'table' },
    { id: 'Bad Id', label: 'x', target: 'post' },
  ],
}

describe('loadEditorPostClasses', () => {
  it('returns only post entries, resolves labels for the admin locale and drops invalid ids', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await loadEditorPostClasses({ locale: 'ja', loadThemeConfig: async () => ({ manifest }) })
    expect(out).toEqual([{ id: 'wide', label: 'ワイド', description: '全幅' }])
    warn.mockRestore()
  })

  it('returns [] for callers without loadThemeConfig', async () => {
    expect(await loadEditorPostClasses(undefined)).toEqual([])
    expect(await loadEditorPostClasses({})).toEqual([])
  })

  it('logs and returns [] when the theme cannot be loaded', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await loadEditorPostClasses({
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
