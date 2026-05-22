import { describe, it, expect } from 'vitest'
import {
  validateBundlePath,
  findAbsolutePathRefs,
  validateBundle,
  mimeTypeFor,
  bundlePrefix,
} from './static-bundle.js'

describe('validateBundlePath', () => {
  it('accepts ordinary relative paths', () => {
    expect(validateBundlePath('index.html')).toBeNull()
    expect(validateBundlePath('assets/style.css')).toBeNull()
    expect(validateBundlePath('a/b/c/d.png')).toBeNull()
  })

  it('rejects absolute paths', () => {
    expect(validateBundlePath('/etc/passwd')).toBe('absolute path')
    expect(validateBundlePath('\\windows\\path')).toBe('absolute path')
  })

  it('rejects parent traversal', () => {
    expect(validateBundlePath('../escape')).toBe('parent-directory traversal')
    expect(validateBundlePath('a/../b')).toBe('parent-directory traversal')
  })

  it('rejects null bytes', () => {
    expect(validateBundlePath('foo\0.html')).toBe('contains null byte')
  })

  it('flags zip junk', () => {
    // macOS resource forks
    expect(validateBundlePath('__MACOSX/foo')).toBe('macOS resource fork')
    expect(validateBundlePath('a/._b')).toBe('macOS resource fork')
    expect(validateBundlePath('.DS_Store')).toBe('.DS_Store junk')
    expect(validateBundlePath('a/.DS_Store')).toBe('.DS_Store junk')
    expect(validateBundlePath('Thumbs.db')).toBe('Thumbs.db junk')
  })

  it('rejects directory entries', () => {
    expect(validateBundlePath('')).toBe('directory entry')
    expect(validateBundlePath('foo/')).toBe('directory entry')
  })
})

describe('findAbsolutePathRefs', () => {
  it('passes a clean HTML file with relative refs', () => {
    const html = `<!DOCTYPE html>
<html><head>
  <link rel="stylesheet" href="./style.css">
  <script src="app.js"></script>
</head><body>
  <img src="img/photo.jpg" alt="">
  <a href="page2.html">next</a>
</body></html>`
    expect(findAbsolutePathRefs('index.html', html)).toEqual([])
  })

  it('flags absolute path in src/href', () => {
    const html = '<img src="/uploads/foo.jpg"><link href="/style.css">'
    const issues = findAbsolutePathRefs('index.html', html)
    expect(issues).toHaveLength(2)
    expect(issues[0]!.reason).toContain('absolute path')
  })

  it('flags protocol-relative URLs', () => {
    const html = '<script src="//cdn.example.com/lib.js"></script>'
    const issues = findAbsolutePathRefs('index.html', html)
    expect(issues).toHaveLength(1)
    expect(issues[0]!.reason).toContain('protocol-relative')
  })

  it('allows fully-qualified URLs (https / mailto / data)', () => {
    const html = `<a href="https://example.com">x</a>
<a href="mailto:foo@example.com">m</a>
<img src="data:image/png;base64,AAAA">`
    expect(findAbsolutePathRefs('index.html', html)).toEqual([])
  })

  it('allows hash-only anchors and empty values', () => {
    const html = '<a href="#top">top</a><a href="">empty</a>'
    expect(findAbsolutePathRefs('index.html', html)).toEqual([])
  })

  it('flags absolute url() in CSS', () => {
    const css = `.bg { background-image: url(/img/bg.png); }
.font { font-family: 'X'; src: url('./fonts/x.woff2'); }
@import "/reset.css";`
    const issues = findAbsolutePathRefs('style.css', css)
    expect(issues).toHaveLength(2)
    expect(issues.map((i) => i.reason).every((r) => r.includes('absolute path'))).toBe(true)
  })

  it('checks each srcset candidate', () => {
    const html = '<img srcset="small.jpg 1x, /large.jpg 2x" src="small.jpg">'
    const issues = findAbsolutePathRefs('index.html', html)
    expect(issues).toHaveLength(1)
  })

  it('ignores non-text files', () => {
    expect(findAbsolutePathRefs('photo.jpg', '/anything/here')).toEqual([])
    expect(findAbsolutePathRefs('script.js', 'fetch("/api/x")')).toEqual([])
  })
})

describe('validateBundle', () => {
  it('aggregates issues across all text files', () => {
    const encoder = new TextEncoder()
    const issues = validateBundle([
      { path: 'index.html', data: encoder.encode('<img src="/abs.png">') },
      { path: 'style.css', data: encoder.encode('.x { background: url(/foo.svg); }') },
      { path: 'photo.jpg', data: new Uint8Array([0xff, 0xd8]) }, // binary, skipped
    ])
    expect(issues).toHaveLength(2)
  })
})

describe('mimeTypeFor', () => {
  it('handles common web extensions', () => {
    expect(mimeTypeFor('index.html')).toBe('text/html; charset=utf-8')
    expect(mimeTypeFor('style.css')).toBe('text/css; charset=utf-8')
    expect(mimeTypeFor('app.js')).toBe('application/javascript; charset=utf-8')
    expect(mimeTypeFor('icon.svg')).toBe('image/svg+xml')
    expect(mimeTypeFor('font.woff2')).toBe('font/woff2')
  })

  it('falls back to octet-stream for unknown extensions', () => {
    expect(mimeTypeFor('mystery.qqq')).toBe('application/octet-stream')
    expect(mimeTypeFor('noext')).toBe('application/octet-stream')
  })

  it('is case-insensitive', () => {
    expect(mimeTypeFor('PHOTO.JPG')).toBe('image/jpeg')
  })
})

describe('bundlePrefix', () => {
  it('builds the canonical S3 prefix', () => {
    expect(bundlePrefix('my-lp')).toBe('public/static/my-lp/')
  })

  it('preserves arbitrary slug strings unchanged', () => {
    // No URL-encoding here — callers ensure inputs are well-formed
    // (slug validation lives in admin form).
    expect(bundlePrefix('a b c')).toBe('public/static/a b c/')
  })
})
