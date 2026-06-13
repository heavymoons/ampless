import { describe, it, expect } from 'vitest'
import { normalizeCodeLanguage } from './code-language.js'

describe('normalizeCodeLanguage', () => {
  it('passes through a simple lowercase token unchanged', () => {
    expect(normalizeCodeLanguage('mermaid')).toBe('mermaid')
  })

  it('lowercases an uppercase input', () => {
    expect(normalizeCodeLanguage('TS')).toBe('ts')
  })

  it('lowercases a mixed-case input', () => {
    expect(normalizeCodeLanguage('JavaScript')).toBe('javascript')
  })

  it('returns null for an empty string', () => {
    expect(normalizeCodeLanguage('')).toBeNull()
  })

  it('returns null for a whitespace-only string', () => {
    expect(normalizeCodeLanguage('   ')).toBeNull()
  })

  it('strips leading/trailing spaces', () => {
    expect(normalizeCodeLanguage(' js ')).toBe('js')
  })

  it('strips internal spaces (foo bar → foobar)', () => {
    expect(normalizeCodeLanguage('foo bar')).toBe('foobar')
  })

  it('strips double-quote characters ("x" → x)', () => {
    expect(normalizeCodeLanguage('"x"')).toBe('x')
  })

  it('strips single-quote characters', () => {
    expect(normalizeCodeLanguage("'ts'")).toBe('ts')
  })

  it('strips backtick characters', () => {
    const result = normalizeCodeLanguage('a`b')
    expect(result).toBe('ab')
  })

  it('strips newline characters', () => {
    const result = normalizeCodeLanguage('a\nb')
    expect(result).toBe('ab')
  })

  it('strips backtick, newline, and fence garbage (a`\\n``` → a or null, no backtick/newline/space)', () => {
    // Input: 'a`\n```'  → after strip: 'a' → valid token
    const result = normalizeCodeLanguage('a`\n```')
    // Result must be null or a valid token with no backtick/newline/space
    if (result !== null) {
      expect(result).not.toMatch(/[`\n ]/)
      expect(result).toMatch(/^[a-z0-9][a-z0-9_-]{0,63}$/)
    }
    // In this case the cleaned string is 'a', which is a valid single-char token
    expect(result).toBe('a')
  })

  it('strips + from c++ (c++ → c)', () => {
    expect(normalizeCodeLanguage('c++')).toBe('c')
  })

  it('strips # from c# (c# → c)', () => {
    expect(normalizeCodeLanguage('c#')).toBe('c')
  })

  it('preserves hyphens in tokens', () => {
    expect(normalizeCodeLanguage('plain-text')).toBe('plain-text')
  })

  it('preserves underscores in tokens', () => {
    expect(normalizeCodeLanguage('my_lang')).toBe('my_lang')
  })

  it('returns null when only disallowed chars remain', () => {
    expect(normalizeCodeLanguage('+++')).toBeNull()
  })

  it('truncates a token longer than 64 chars to 64', () => {
    // 65 'a' characters — cleaned produces 65 'a's but TOKEN caps at 64 total
    const long = 'a'.repeat(65)
    const result = normalizeCodeLanguage(long)
    // cleaned = 65 a's; TOKEN requires [a-z0-9][a-z0-9_-]{0,63} = 1+63 = max 64
    // 65 chars fails the regex, so result should be null
    expect(result).toBeNull()
  })

  it('accepts a token of exactly 64 chars', () => {
    const exact = 'a'.repeat(64)
    expect(normalizeCodeLanguage(exact)).toBe(exact)
  })
})
