import { describe, it, expect } from 'vitest'
import { chooseHighlightHref } from './theme.js'

const V = '11.11.1'
const base = `https://cdn.jsdelivr.net/npm/highlight.js@${V}/styles/`

describe('chooseHighlightHref', () => {
  it('auto + dark -> github-dark stylesheet', () => {
    expect(chooseHighlightHref('auto', true, V)).toBe(base + 'github-dark.min.css')
  })

  it('auto + light -> github stylesheet', () => {
    expect(chooseHighlightHref('auto', false, V)).toBe(base + 'github.min.css')
  })

  it('explicit theme pins regardless of scheme', () => {
    expect(chooseHighlightHref('github-dark', false, V)).toBe(base + 'github-dark.min.css')
    expect(chooseHighlightHref('monokai', true, V)).toBe(base + 'monokai.min.css')
    expect(chooseHighlightHref('atom-one-dark', false, V)).toBe(base + 'atom-one-dark.min.css')
  })

  it('composes the URL with the validated version', () => {
    expect(chooseHighlightHref('auto', false, '11.4.1')).toBe(
      'https://cdn.jsdelivr.net/npm/highlight.js@11.4.1/styles/github.min.css'
    )
  })
})
