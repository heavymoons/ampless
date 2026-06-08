import { describe, it, expect } from 'vitest'
import youtubePlugin from './index.js'

describe('youtubePlugin name', () => {
  it('uses simple identifier as default name', () => {
    const p = youtubePlugin()
    expect(p.name).toBe('youtube')
  })

  it('allows name override via opts', () => {
    const p = youtubePlugin({ name: 'my-yt' })
    expect(p.name).toBe('my-yt')
  })
})
