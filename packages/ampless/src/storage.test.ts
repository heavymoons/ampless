import { describe, it, expect } from 'vitest'
import { formatPublicAssetUrl } from './storage.js'

describe('formatPublicAssetUrl', () => {
  it('builds a regional virtual-host URL', () => {
    expect(formatPublicAssetUrl('my-bucket', 'ap-northeast-1', 'public/foo.xml')).toBe(
      'https://my-bucket.s3.ap-northeast-1.amazonaws.com/public/foo.xml'
    )
  })

  it('does not strip slashes from the key', () => {
    expect(formatPublicAssetUrl('b', 'us-east-1', 'a/b/c')).toBe(
      'https://b.s3.us-east-1.amazonaws.com/a/b/c'
    )
  })

  it('does not encode the key (caller is responsible if needed)', () => {
    expect(formatPublicAssetUrl('b', 'us-east-1', 'name with space')).toBe(
      'https://b.s3.us-east-1.amazonaws.com/name with space'
    )
  })
})
