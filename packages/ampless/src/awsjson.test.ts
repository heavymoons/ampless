import { describe, it, expect } from 'vitest'
import { encodeAwsJson, decodeAwsJson } from './awsjson.js'

describe('encodeAwsJson', () => {
  it('stringifies objects', () => {
    expect(encodeAwsJson({ type: 'doc', content: [] })).toBe('{"type":"doc","content":[]}')
  })

  it('stringifies arrays', () => {
    expect(encodeAwsJson([1, 2, 3])).toBe('[1,2,3]')
  })

  it('wraps raw strings as JSON string literals (markdown / html bodies)', () => {
    expect(encodeAwsJson('# hello')).toBe('"# hello"')
    expect(encodeAwsJson('<p>hi</p>')).toBe('"<p>hi</p>"')
  })

  it('serialises undefined / null as JSON null', () => {
    expect(encodeAwsJson(undefined)).toBe('null')
    expect(encodeAwsJson(null)).toBe('null')
  })

  it('stringifies primitives', () => {
    expect(encodeAwsJson(42)).toBe('42')
    expect(encodeAwsJson(true)).toBe('true')
  })
})

describe('decodeAwsJson', () => {
  it('parses JSON-encoded strings back to native values', () => {
    expect(decodeAwsJson('{"type":"doc"}')).toEqual({ type: 'doc' })
    expect(decodeAwsJson('"# hello"')).toBe('# hello')
    expect(decodeAwsJson('[1,2,3]')).toEqual([1, 2, 3])
    expect(decodeAwsJson('null')).toBeNull()
  })

  it('passes non-string values through unchanged (DynamoDB unmarshalled shape)', () => {
    const obj = { type: 'doc' }
    expect(decodeAwsJson(obj)).toBe(obj)
    expect(decodeAwsJson(42)).toBe(42)
    expect(decodeAwsJson(null)).toBeNull()
    expect(decodeAwsJson(undefined)).toBeUndefined()
  })

  it('falls back to the raw string on invalid JSON (bare-string rows)', () => {
    expect(decodeAwsJson('not json')).toBe('not json')
    expect(decodeAwsJson('# hello')).toBe('# hello')
  })

  it('round-trips through encode → decode', () => {
    const cases: unknown[] = [
      { type: 'doc', content: [{ type: 'paragraph' }] },
      [1, 'two', { three: 3 }],
      '# Markdown body',
      null,
      42,
      true,
    ]
    for (const value of cases) {
      expect(decodeAwsJson(encodeAwsJson(value))).toEqual(value ?? null)
    }
  })
})
