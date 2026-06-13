import { describe, it, expect } from 'vitest'
import { chooseMermaidTheme } from './theme.js'

describe('chooseMermaidTheme', () => {
  it('auto + dark -> "dark"', () => {
    expect(chooseMermaidTheme('auto', true)).toBe('dark')
  })

  it('auto + light -> "default"', () => {
    expect(chooseMermaidTheme('auto', false)).toBe('default')
  })

  it('explicit theme pins regardless of scheme', () => {
    expect(chooseMermaidTheme('dark', false)).toBe('dark')
    expect(chooseMermaidTheme('default', true)).toBe('default')
    expect(chooseMermaidTheme('forest', true)).toBe('forest')
    expect(chooseMermaidTheme('neutral', false)).toBe('neutral')
    expect(chooseMermaidTheme('base', true)).toBe('base')
  })
})
