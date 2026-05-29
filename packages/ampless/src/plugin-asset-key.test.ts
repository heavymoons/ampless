import { describe, expect, it } from 'vitest'
import { validatePublicAssetKey } from './plugin-asset-key.js'

describe('validatePublicAssetKey', () => {
  it('rejects an empty key', () => {
    expect(validatePublicAssetKey('')).toMatch(/empty/)
  })

  it('rejects absolute paths', () => {
    expect(validatePublicAssetKey('/foo')).toMatch(/relative/)
  })

  it('rejects parent traversal at the start', () => {
    expect(validatePublicAssetKey('../escape')).toMatch(/\.\./)
  })

  it('rejects parent traversal in the middle', () => {
    expect(validatePublicAssetKey('sub/../parent')).toMatch(/\.\./)
  })

  it('accepts a simple filename', () => {
    expect(validatePublicAssetKey('foo.xml')).toBeNull()
  })

  it('accepts a nested relative path', () => {
    expect(validatePublicAssetKey('subdir/foo.xml')).toBeNull()
  })

  it('rejects keys longer than 256 characters', () => {
    expect(validatePublicAssetKey('a'.repeat(257))).toMatch(/256/)
  })

  it('rejects null and control characters', () => {
    expect(validatePublicAssetKey('\0null')).toMatch(/control/)
  })

  it('rejects backslashes', () => {
    expect(validatePublicAssetKey('dir\\file.xml')).toMatch(/backslashes/)
  })

  it('rejects URL fragment characters', () => {
    expect(validatePublicAssetKey('foo#bar.xml')).toMatch(/ASCII letters/)
  })

  it('rejects URL query characters', () => {
    expect(validatePublicAssetKey('foo?x=1.xml')).toMatch(/ASCII letters/)
  })

  it('rejects spaces', () => {
    expect(validatePublicAssetKey('space file.xml')).toMatch(/ASCII letters/)
  })

  it('rejects URL-reserved + and &', () => {
    expect(validatePublicAssetKey('foo+bar.xml')).toMatch(/ASCII letters/)
    expect(validatePublicAssetKey('foo&bar.xml')).toMatch(/ASCII letters/)
  })

  it('rejects non-ASCII characters', () => {
    expect(validatePublicAssetKey('日本語.xml')).toMatch(/ASCII letters/)
  })

  it('accepts paths with dots and hyphens', () => {
    expect(validatePublicAssetKey('feed-archive.v2.xml')).toBeNull()
    expect(validatePublicAssetKey('cache/snapshot_2026-05-28.json')).toBeNull()
  })
})
