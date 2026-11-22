import { describe, it, expect } from 'vitest'
import {
  validateBundlePath,
  findAbsolutePathRefs,
  validateBundle,
  mimeTypeFor,
  bundlePrefix,
  stripCommonPrefix,
  pickDefaultEntrypoint,
  DEFAULT_ENTRYPOINT,
  isReservedStaticSlug,
  isValidBundleVersion,
  generateBundleVersion,
  versionedBundlesPrefix,
  versionedBundlePrefix,
  staticBundleVersion,
  staticBundlePrefix,
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
      { path: 'photo.jpg', data: new Uint8Array([0xff, 0xd8]) },
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
    expect(bundlePrefix('a b c')).toBe('public/static/a b c/')
  })

  it('refuses a slug whose prefix would contain the versioned area', () => {
    expect(() => bundlePrefix('_v')).toThrow(/reserved/)
    expect(() => bundlePrefix('_v/my-lp')).toThrow(/reserved/)
    // Only the exact segment is reserved.
    expect(bundlePrefix('_v2')).toBe('public/static/_v2/')
    expect(bundlePrefix('v')).toBe('public/static/v/')
  })
})

describe('isReservedStaticSlug', () => {
  it('matches `_v` and `_v/…` only', () => {
    expect(isReservedStaticSlug('_v')).toBe(true)
    expect(isReservedStaticSlug('_v/x')).toBe(true)
    expect(isReservedStaticSlug('_v-x')).toBe(false)
    expect(isReservedStaticSlug('x/_v')).toBe(false)
    expect(isReservedStaticSlug('')).toBe(false)
  })
})

describe('bundle versions', () => {
  it('generates valid, distinct ids', () => {
    const a = generateBundleVersion(Date.UTC(2026, 10, 22))
    const b = generateBundleVersion(Date.UTC(2026, 10, 22))
    expect(isValidBundleVersion(a)).toBe(true)
    expect(isValidBundleVersion(b)).toBe(true)
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[a-z0-9]+-[0-9a-f]{10}$/)
  })

  it('validates the charset and length', () => {
    expect(isValidBundleVersion('mhx3k2a1-4f9c0d2e7b')).toBe(true)
    expect(isValidBundleVersion('v1')).toBe(true)
    for (const bad of ['', 'V1', 'a/b', '..', 'a.b', '-a', 'a-', 'a--b', 'a b', 'a'.repeat(65), 1, null, undefined]) {
      expect(isValidBundleVersion(bad)).toBe(false)
    }
  })

  it('staticBundleVersion reads only a valid version', () => {
    expect(staticBundleVersion({ entrypoint: 'index.html', files: [], uploadedAt: 'x', version: 'v1' })).toBe('v1')
    expect(staticBundleVersion({ entrypoint: 'index.html', files: [], uploadedAt: 'x' })).toBeUndefined()
    expect(staticBundleVersion({ version: '../x' })).toBeUndefined()
    expect(staticBundleVersion(null)).toBeUndefined()
    expect(staticBundleVersion('v1')).toBeUndefined()
  })
})

describe('versioned prefixes', () => {
  it('nests versions under the reserved segment, slug encoded as one segment', () => {
    expect(versionedBundlesPrefix('my-lp')).toBe('public/static/_v/my-lp/')
    expect(versionedBundlePrefix('my-lp', 'v1')).toBe('public/static/_v/my-lp/v1/')
    // A slug with `/` cannot nest inside another slug's versions.
    expect(versionedBundlesPrefix('a/v1')).toBe('public/static/_v/a%2Fv1/')
    expect(versionedBundlePrefix('a', 'v1').startsWith(versionedBundlesPrefix('a/v1'))).toBe(false)
    expect(versionedBundlesPrefix('_v')).toBe('public/static/_v/_v/')
  })

  it('never overlaps a legacy prefix of a non-reserved slug', () => {
    for (const slug of ['my-lp', 'v', '_v2', 'a b', 'static']) {
      expect(versionedBundlePrefix('my-lp', 'v1').startsWith(bundlePrefix(slug))).toBe(false)
    }
  })

  it('rejects an invalid version', () => {
    expect(() => versionedBundlePrefix('my-lp', '../x')).toThrow(/Invalid static bundle version/)
  })
})

describe('staticBundlePrefix', () => {
  const base = { entrypoint: 'index.html', files: ['index.html'], uploadedAt: '2026-01-01T00:00:00.000Z' }

  it('uses the versioned prefix for a valid version', () => {
    expect(staticBundlePrefix('my-lp', { ...base, version: 'v1' })).toBe('public/static/_v/my-lp/v1/')
  })

  it('falls back to the unchanged legacy prefix for absent / invalid versions', () => {
    expect(staticBundlePrefix('my-lp', base)).toBe('public/static/my-lp/')
    expect(staticBundlePrefix('my-lp', { ...base, version: 'A/B' })).toBe('public/static/my-lp/')
    expect(staticBundlePrefix('my-lp', null)).toBe('public/static/my-lp/')
  })
})

describe('stripCommonPrefix', () => {
  it('strips a single shared top-level directory', () => {
    const stripped = stripCommonPrefix([
      { path: 'MyBundle/index.html', data: new Uint8Array() },
      { path: 'MyBundle/assets/style.css', data: new Uint8Array() },
    ])
    expect(stripped.map((f) => f.path)).toEqual(['index.html', 'assets/style.css'])
  })

  it('leaves bundles already at root unchanged', () => {
    const files = [
      { path: 'index.html', data: new Uint8Array() },
      { path: 'style.css', data: new Uint8Array() },
    ]
    expect(stripCommonPrefix(files).map((f) => f.path)).toEqual(['index.html', 'style.css'])
  })

  it('leaves mixed-root layouts unchanged', () => {
    const files = [
      { path: 'a/index.html', data: new Uint8Array() },
      { path: 'b/index.html', data: new Uint8Array() },
    ]
    expect(stripCommonPrefix(files).map((f) => f.path)).toEqual([
      'a/index.html',
      'b/index.html',
    ])
  })

  it('passes empty arrays through', () => {
    expect(stripCommonPrefix([])).toEqual([])
  })
})

describe('pickDefaultEntrypoint', () => {
  it('prefers index.html at root', () => {
    expect(
      pickDefaultEntrypoint([
        { path: 'about.html' },
        { path: 'index.html' },
        { path: 'index.htm' },
      ]),
    ).toBe('index.html')
  })

  it('falls back to index.htm when index.html is absent', () => {
    expect(pickDefaultEntrypoint([{ path: 'index.htm' }, { path: 'about.html' }])).toBe(
      'index.htm',
    )
  })

  it('picks the first alphabetical .html at root when no index exists', () => {
    expect(
      pickDefaultEntrypoint([
        { path: 'main.html' },
        { path: 'about.html' },
        { path: 'docs/inner.html' },
      ]),
    ).toBe('about.html')
  })

  it('falls back to nested .html if nothing at root', () => {
    expect(
      pickDefaultEntrypoint([{ path: 'pages/a.html' }, { path: 'pages/b.html' }]),
    ).toBe('pages/a.html')
  })

  it('returns DEFAULT_ENTRYPOINT when nothing matches', () => {
    expect(pickDefaultEntrypoint([{ path: 'style.css' }])).toBe(DEFAULT_ENTRYPOINT)
    expect(pickDefaultEntrypoint([])).toBe(DEFAULT_ENTRYPOINT)
  })
})
