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
})
