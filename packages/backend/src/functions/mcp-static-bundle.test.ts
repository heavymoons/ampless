import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { extractZipFromBuffer } from './mcp-static-bundle.js'

function buildZip(entries: Record<string, string | Uint8Array>): Uint8Array {
  const u8: Record<string, Uint8Array> = {}
  for (const [k, v] of Object.entries(entries)) {
    u8[k] = typeof v === 'string' ? strToU8(v) : v
  }
  return zipSync(u8)
}

describe('extractZipFromBuffer', () => {
  it('decodes a simple bundle and surfaces every entry', () => {
    const zip = buildZip({
      'index.html': '<!doctype html>',
      'style.css': 'body{color:red}',
      'logo.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    })

    const result = extractZipFromBuffer(zip)
    expect(result.issues).toEqual([])
    const paths = result.files.map((f) => f.path).sort()
    expect(paths).toEqual(['index.html', 'logo.png', 'style.css'])
    expect(result.totalBytes).toBe(
      '<!doctype html>'.length + 'body{color:red}'.length + 4,
    )
  })

  it('silently drops macOS / Windows zip junk entries', () => {
    const zip = buildZip({
      'index.html': '<!doctype html>',
      '__MACOSX/index.html': 'junk',
      '.DS_Store': 'junk',
      'Thumbs.db': 'junk',
    })

    const result = extractZipFromBuffer(zip)
    expect(result.issues).toEqual([])
    expect(result.files.map((f) => f.path)).toEqual(['index.html'])
  })

  it('surfaces structural issues (parent traversal, absolute paths)', () => {
    const zip = buildZip({
      'index.html': '<!doctype html>',
      '../escape.txt': 'no',
    })

    const result = extractZipFromBuffer(zip)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]!.reason).toBe('parent-directory traversal')
    expect(result.files.map((f) => f.path)).toEqual(['index.html'])
  })

  it('strips a single wrapping directory (macOS Finder zip layout)', () => {
    const zip = buildZip({
      'MyBundle/index.html': '<!doctype html>',
      'MyBundle/style.css': 'body{}',
    })

    const result = extractZipFromBuffer(zip)
    expect(result.files.map((f) => f.path).sort()).toEqual(['index.html', 'style.css'])
  })

  it('enforces maxBytes', () => {
    const big = new Uint8Array(1024)
    const zip = buildZip({ 'big.bin': big })

    expect(() => extractZipFromBuffer(zip, { maxBytes: 512 })).toThrow(/too large/i)
  })

  it('throws on a corrupt archive', () => {
    const garbage = new Uint8Array([0, 1, 2, 3, 4, 5])
    expect(() => extractZipFromBuffer(garbage)).toThrow()
  })
})
