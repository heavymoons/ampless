import { describe, it, expect } from 'vitest'
import { createStorage } from './storage.js'

describe('createStorage', () => {
  it('builds a regional public URL when storage is configured', () => {
    const s = createStorage({
      storage: { bucket_name: 'my-bucket', aws_region: 'ap-northeast-1' },
    })
    expect(s.isStorageConfigured()).toBe(true)
    expect(s.publicAssetUrl('public/foo.xml')).toBe(
      'https://my-bucket.s3.ap-northeast-1.amazonaws.com/public/foo.xml'
    )
  })

  it('reports unconfigured when storage is absent', () => {
    const s = createStorage({})
    expect(s.isStorageConfigured()).toBe(false)
  })

  it('throws on publicAssetUrl when storage is absent (deploy-time precondition)', () => {
    const s = createStorage({})
    expect(() => s.publicAssetUrl('public/foo.xml')).toThrow(/storage output missing/)
  })
})
