import { describe, it, expect } from 'vitest'
import xEmbedPlugin from './index.js'

describe('xEmbedPlugin name', () => {
  it('uses simple identifier as default name', () => {
    const p = xEmbedPlugin()
    expect(p.name).toBe('x-embed')
  })

  it('allows name override via opts', () => {
    const p = xEmbedPlugin({ name: 'my-x' })
    expect(p.name).toBe('my-x')
  })
})
