import { describe, it, expect } from 'vitest'
import { sanitizeName, buildMediaKey } from './s3.js'

describe('sanitizeName', () => {
  it('preserves Japanese / emoji', () => {
    expect(sanitizeName('日本語ファイル.png')).toBe('日本語ファイル.png')
  })

  it('replaces path-unsafe characters with underscore', () => {
    expect(sanitizeName('a/b\\c:d*e?"<>|.png')).toBe('a_b_c_d_e_____.png')
  })

  it('strips leading dots so dotfiles don’t escape the prefix', () => {
    expect(sanitizeName('...secret.txt')).toMatch(/^_/)
  })

  it('compresses whitespace runs', () => {
    expect(sanitizeName('   spaced   name.png')).toBe('_spaced_name.png')
  })

  it('falls back to "upload" when input is empty after stripping', () => {
    expect(sanitizeName('')).toBe('upload')
    expect(sanitizeName('\x00\x01')).toBe('upload')
  })
})

describe('buildMediaKey', () => {
  it('produces public/media/YYYY/MM/{ts}-{name}', () => {
    const now = new Date('2026-04-30T10:00:00.000Z')
    const key = buildMediaKey('photo.png', now)
    expect(key).toMatch(/^public\/media\/2026\/04\/\d+-photo\.png$/)
  })

  it('zero-pads the month', () => {
    const now = new Date('2026-01-05T00:00:00.000Z')
    const key = buildMediaKey('a.png', now)
    expect(key).toContain('/2026/01/')
  })
})
