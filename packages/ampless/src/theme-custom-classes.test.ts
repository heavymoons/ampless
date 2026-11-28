import { describe, it, expect, vi } from 'vitest'
import {
  bypassesPostBodyWrapper,
  isValidCustomClassId,
  POST_CLASSES_METADATA_KEY,
  POST_CLASSES_METADATA_KIND,
  postBodyClassName,
  postCustomClassName,
  readPostClasses,
  tableCustomClassName,
  themeCustomClasses,
  themePostClasses,
  themeTableClasses,
  hasForeignPostClassesValue,
  postClassesMetadataError,
  withPostClasses,
  type PostClassesMetadata,
  type ThemeManifest,
} from './theme.js'
import type { Post, PostMetadata } from './types.js'

describe('theme custom classes', () => {
  it('isValidCustomClassId accepts lowercase / digits / hyphens only', () => {
    for (const ok of ['compact', 'rank-2col', 'a', '9', 'a'.repeat(64)]) expect(isValidCustomClassId(ok)).toBe(true)
    for (const bad of ['', 'Compact', 'a b', 'a_b', 'x"y', '<x>', 'a'.repeat(65), 1, null, undefined, ['a']])
      expect(isValidCustomClassId(bad)).toBe(false)
  })

  it('tableCustomClassName prefixes the base table class', () => {
    expect(tableCustomClassName('compact')).toBe('tiptap-table--compact')
  })

  it('themeTableClasses keeps valid table entries, first id wins, ignores other targets', () => {
    const manifest = {
      name: 't',
      customClasses: [
        { id: 'compact', label: 'Compact', target: 'table' },
        { id: 'Bad Id', label: 'x', target: 'table' },
        { id: 'compact', label: 'Duplicate', target: 'table' },
        { id: 'striped', label: { en: 'Striped', ja: 'ストライプ' }, target: 'table' },
        { id: 'post-only', label: 'x', target: 'post' },
      ],
    } as unknown as ThemeManifest
    const out = themeTableClasses(manifest)
    expect(out.map((c) => c.id)).toEqual(['compact', 'striped'])
    expect(out[0]!.label).toBe('Compact')
  })

  it('themeTableClasses returns [] when the manifest declares none', () => {
    expect(themeTableClasses({ name: 't' })).toEqual([])
  })

  it('themePostClasses keeps valid post entries only; table entries are unaffected', () => {
    const manifest = {
      name: 't',
      customClasses: [
        { id: 'compact', label: 'Compact', target: 'table' },
        { id: 'wide', label: 'Wide', target: 'post' },
        { id: 'Bad', label: 'x', target: 'post' },
        { id: 'wide', label: 'Duplicate', target: 'post' },
        { id: 'serif', label: 'Serif', target: 'post' },
      ],
    } as unknown as ThemeManifest
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const posts = themePostClasses(manifest)
    expect(posts.map((c) => c.id)).toEqual(['wide', 'serif'])
    expect(posts[0]!.label).toBe('Wide')
    expect(themeTableClasses(manifest).map((c) => c.id)).toEqual(['compact'])
    expect(themeCustomClasses(manifest, 'table')).toEqual(themeTableClasses(manifest))
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('postCustomClassName prefixes ampless-post--', () => {
    expect(postCustomClassName('wide')).toBe('ampless-post--wide')
  })

  const tagged = (ids: unknown): PostMetadata => ({
    [POST_CLASSES_METADATA_KEY]: { kind: POST_CLASSES_METADATA_KIND, version: 1, ids },
  })

  it('stores post classes under a namespaced key with a kind tag', () => {
    expect(POST_CLASSES_METADATA_KEY).toBe('ampless:postClasses')
    expect(POST_CLASSES_METADATA_KIND).toBe('ampless.post-classes')
    const value: PostClassesMetadata = { kind: 'ampless.post-classes', version: 1, ids: ['wide'] }
    expect(readPostClasses({ [POST_CLASSES_METADATA_KEY]: value })).toEqual(['wide'])
  })

  it('readPostClasses reads the tagged value only, drops invalid ids, de-dupes in order', () => {
    expect(readPostClasses(tagged(['serif', 'wide', 'serif', 'Bad', 3, null, 'x" onmouseover=', 'wide']))).toEqual([
      'serif',
      'wide',
    ])
    expect(readPostClasses(tagged(['b', 'a', 'c', 'a', 'b', 'd', 'c']))).toEqual(['b', 'a', 'c', 'd'])
    for (const notMetadata of [undefined, null, 'x', 1, ['wide']]) expect(readPostClasses(notMetadata)).toEqual([])
    for (const notTagged of [
      ['wide'],
      'wide',
      { ids: ['wide'] },
      { kind: 'ampless.post-classes', ids: ['wide'] },
      { kind: 'ampless.post-classes', version: 2, ids: ['wide'] },
      { kind: 'ampless.post-classes', version: '1', ids: ['wide'] },
      { kind: 'other', version: 1, ids: ['wide'] },
      { kind: 'ampless.post-classes', version: 1, ids: 'wide' },
      { kind: 'ampless.post-classes', version: 1, ids: { 0: 'wide' } },
    ])
      expect(readPostClasses({ [POST_CLASSES_METADATA_KEY]: notTagged })).toEqual([])
  })

  const themed = (metadata?: PostMetadata): Pick<Post, 'format' | 'metadata'> => ({ format: 'tiptap', metadata })

  it('readPostClasses keeps every unique id of a large list, in first-occurrence order (no cap)', () => {
    const n = 20_000
    const unique = Array.from({ length: n }, (_, i) => `c-${i}`)
    // Each id twice (second copy in reverse order) with invalid entries mixed in.
    const stored = [...unique.flatMap((id, i) => (i % 1000 === 0 ? [id, 'Bad'] : [id])), ...[...unique].reverse(), 7]
    const out = readPostClasses(tagged(stored))
    expect(out).toHaveLength(n)
    expect(out).toEqual(unique)
    expect(postBodyClassName(themed(tagged(stored))).split(' ')).toEqual(unique.map(postCustomClassName))
  })

  it('postBodyClassName returns base unchanged without classes and appends otherwise', () => {
    expect(postBodyClassName(undefined, 'prose')).toBe('prose')
    expect(postBodyClassName(null)).toBe('')
    expect(postBodyClassName(themed(), 'prose')).toBe('prose')
    expect(postBodyClassName(themed({}), 'prose')).toBe('prose')
    expect(postBodyClassName(themed({ cache: 'deep', no_layout: false }), 'prose')).toBe('prose')
    expect(postBodyClassName(themed(tagged([])), 'prose max-w-none')).toBe('prose max-w-none')
    expect(postBodyClassName(themed(tagged(['<x>'])), 'prose')).toBe('prose')
    expect(postBodyClassName(themed(tagged(['wide', 'serif'])), 'prose')).toBe(
      'prose ampless-post--wide ampless-post--serif',
    )
    expect(postBodyClassName(themed(tagged(['wide'])))).toBe('ampless-post--wide')
    for (const format of ['markdown', 'html'] as const)
      expect(postBodyClassName({ format, metadata: tagged(['wide']) }, 'prose')).toBe('prose ampless-post--wide')
  })

  describe('static and no_layout HTML posts', () => {
    it('bypassesPostBodyWrapper follows the middleware routing rule', () => {
      expect(bypassesPostBodyWrapper({ format: 'static' })).toBe(true)
      expect(bypassesPostBodyWrapper({ format: 'static', metadata: { no_layout: false } })).toBe(true)
      expect(bypassesPostBodyWrapper({ format: 'html', metadata: { no_layout: true } })).toBe(true)
      expect(bypassesPostBodyWrapper({ format: 'html' })).toBe(false)
      expect(bypassesPostBodyWrapper({ format: 'html', metadata: { no_layout: 'true' as never } })).toBe(false)
      for (const format of ['tiptap', 'markdown'] as const)
        expect(bypassesPostBodyWrapper({ format, metadata: { no_layout: true } })).toBe(false)
    })

    it('postBodyClassName never adds post classes to them, even with the tagged value', () => {
      const metadata = tagged(['wide'])
      expect(postBodyClassName({ format: 'static', metadata }, 'prose')).toBe('prose')
      expect(postBodyClassName({ format: 'static', metadata })).toBe('')
      expect(postBodyClassName({ format: 'html', metadata: { ...metadata, no_layout: true } }, 'prose')).toBe('prose')
    })
  })

  describe('existing posts (regression)', () => {
    // Type compatibility: `postClasses` stays a free-form key. These
    // assignments are checked by `tsc --noEmit` (`pnpm lint`); a typed
    // `postClasses` field on PostMetadata would make them compile errors.
    const legacyObject: PostMetadata = { postClasses: { theme: 'x', enabled: true } }
    const legacyString: PostMetadata = { postClasses: 'wide' }
    const legacyNumbers: PostMetadata = { postClasses: [1, 2] }
    const legacyArray: PostMetadata = { postClasses: ['wide', 'serif'] }
    const legacyBoth: PostMetadata = { ...legacyArray, ...tagged(['compact']) }

    it('does not render a legacy postClasses value of any type, valid-looking arrays included', () => {
      for (const metadata of [legacyObject, legacyString, legacyNumbers, legacyArray]) {
        expect(postBodyClassName(themed(metadata), 'prose')).toBe('prose')
        expect(readPostClasses(metadata)).toEqual([])
      }
    })

    it('reads only the tagged value when a legacy postClasses sits next to it', () => {
      expect(postBodyClassName(themed(legacyBoth), 'prose')).toBe('prose ampless-post--compact')
    })

    it('leaves the metadata untouched', () => {
      for (const metadata of [legacyObject, legacyArray, legacyBoth]) {
        const before = structuredClone(metadata)
        postBodyClassName(themed(metadata), 'prose')
        postBodyClassName({ format: 'static', metadata }, 'prose')
        readPostClasses(metadata)
        expect(metadata).toEqual(before)
      }
    })
  })

  describe('withPostClasses (write helper)', () => {
    const value = (ids: string[]): PostClassesMetadata => ({ kind: POST_CLASSES_METADATA_KIND, version: 1, ids })

    it('sets a tagged value and preserves every other key, legacy postClasses included', () => {
      const before: PostMetadata = {
        cache: 'deep',
        no_layout: false,
        postClasses: ['legacy'],
        seo: { title: 'T' },
        files: { 'a.css': { size: 1, mimeType: 'text/css' } },
      }
      const snapshot = structuredClone(before)
      const next = withPostClasses(before, ['wide', 'serif'])
      expect(next).toEqual({ ...snapshot, [POST_CLASSES_METADATA_KEY]: value(['wide', 'serif']) })
      // A new object; the input is not mutated.
      expect(next).not.toBe(before)
      expect(before).toEqual(snapshot)
      expect(readPostClasses(next)).toEqual(['wide', 'serif'])
    })

    it('de-duplicates ids keeping first-occurrence order', () => {
      expect(withPostClasses({}, ['b', 'a', 'b'])[POST_CLASSES_METADATA_KEY]).toEqual(value(['b', 'a']))
    })

    it('replaces an existing tagged value', () => {
      const next = withPostClasses({ x: 1, [POST_CLASSES_METADATA_KEY]: value(['old']) }, ['new'])
      expect(next).toEqual({ x: 1, [POST_CLASSES_METADATA_KEY]: value(['new']) })
    })

    it('removes the key entirely on an empty list', () => {
      const next = withPostClasses({ postClasses: 'legacy', [POST_CLASSES_METADATA_KEY]: value(['wide']) }, [])
      expect(next).toEqual({ postClasses: 'legacy' })
      expect(Object.prototype.hasOwnProperty.call(next, POST_CLASSES_METADATA_KEY)).toBe(false)
      expect(withPostClasses(undefined, [])).toEqual({})
    })

    it('throws on an invalid id instead of dropping it', () => {
      for (const bad of ['Wide', 'a b', 'x"y', '', 'a'.repeat(65)]) {
        expect(() => withPostClasses({}, ['ok', bad])).toThrow(/Invalid post class id/)
      }
    })

    it('refuses to overwrite a foreign value under the namespaced key', () => {
      for (const foreign of ['wide', ['wide'], { ids: ['wide'] }, { ...value(['a']), version: 2 }, null, 0]) {
        const metadata: PostMetadata = { [POST_CLASSES_METADATA_KEY]: foreign }
        expect(hasForeignPostClassesValue(metadata)).toBe(true)
        expect(() => withPostClasses(metadata, ['wide'])).toThrow(/refusing to overwrite/)
        expect(() => withPostClasses(metadata, [])).toThrow(/refusing to overwrite/)
      }
    })

    it('hasForeignPostClassesValue is false for no key, undefined, and tagged values', () => {
      expect(hasForeignPostClassesValue(undefined)).toBe(false)
      expect(hasForeignPostClassesValue({ postClasses: 'legacy' })).toBe(false)
      expect(hasForeignPostClassesValue({ [POST_CLASSES_METADATA_KEY]: undefined })).toBe(false)
      expect(hasForeignPostClassesValue({ [POST_CLASSES_METADATA_KEY]: value(['a']) })).toBe(false)
    })

    it('postClassesMetadataError flags invalid ids in a tagged value only', () => {
      expect(postClassesMetadataError({ [POST_CLASSES_METADATA_KEY]: value(['ok']) })).toBeNull()
      expect(postClassesMetadataError({ postClasses: ['Bad Id'] })).toBeNull()
      expect(postClassesMetadataError({ [POST_CLASSES_METADATA_KEY]: 'foreign' })).toBeNull()
      expect(postClassesMetadataError(undefined)).toBeNull()
      expect(postClassesMetadataError({ [POST_CLASSES_METADATA_KEY]: value(['ok', 'Bad Id']) })).toMatch(
        /invalid post class id "Bad Id"/,
      )
    })
  })
})
