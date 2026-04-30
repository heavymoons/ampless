import { describe, it, expect } from 'vitest'
import { escapeXml } from './xml.js'

describe('escapeXml', () => {
  it('escapes the five XML metacharacters', () => {
    expect(escapeXml(`<a href="x" data='y'>&copy;</a>`)).toBe(
      '&lt;a href=&quot;x&quot; data=&#39;y&#39;&gt;&amp;copy;&lt;/a&gt;'
    )
  })

  it('uses &#39; for apostrophe (not &apos;)', () => {
    expect(escapeXml("it's")).toBe('it&#39;s')
  })

  it('escapes ampersand before other entities', () => {
    expect(escapeXml('&amp;')).toBe('&amp;amp;')
  })

  it('passes plain text unchanged', () => {
    expect(escapeXml('hello world')).toBe('hello world')
  })

  it('handles empty string', () => {
    expect(escapeXml('')).toBe('')
  })
})
