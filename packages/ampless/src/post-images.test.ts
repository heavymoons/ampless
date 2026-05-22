import { describe, it, expect } from 'vitest'
import type { Post } from './types.js'
import { extractFirstImageUrl } from './post-images.js'

function makePost(overrides: Partial<Post>): Post {
  return {
    postId: 'p1',
    slug: 'hello',
    title: 'Hello',
    format: 'markdown',
    body: '',
    status: 'published',
    ...overrides,
  }
}

describe('extractFirstImageUrl — tiptap', () => {
  it('finds the first image node in a nested tiptap tree', () => {
    const body = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'before' },
            { type: 'image', attrs: { src: 'https://cdn.example.com/a.webp', alt: 'a' } },
            { type: 'image', attrs: { src: 'https://cdn.example.com/b.webp' } },
          ],
        },
      ],
    }
    const post = makePost({ format: 'tiptap', body })
    expect(extractFirstImageUrl(post)).toBe('https://cdn.example.com/a.webp')
  })

  it('returns null when no image node exists', () => {
    const body = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'plain' }] }],
    }
    const post = makePost({ format: 'tiptap', body })
    expect(extractFirstImageUrl(post)).toBeNull()
  })

  it('returns null when body is not an object', () => {
    expect(extractFirstImageUrl(makePost({ format: 'tiptap', body: null }))).toBeNull()
    expect(extractFirstImageUrl(makePost({ format: 'tiptap', body: 'string' }))).toBeNull()
  })

  it('ignores image nodes whose src attribute is missing or empty', () => {
    const body = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: '' } },
        { type: 'image', attrs: {} },
        { type: 'image', attrs: { src: 'https://cdn.example.com/c.png' } },
      ],
    }
    const post = makePost({ format: 'tiptap', body })
    expect(extractFirstImageUrl(post)).toBe('https://cdn.example.com/c.png')
  })
})

describe('extractFirstImageUrl — markdown', () => {
  it('finds the first ![alt](src) pattern', () => {
    const body =
      'Intro text\n\n![alt one](https://cdn.example.com/a.webp)\n\n![alt two](https://cdn.example.com/b.webp)'
    const post = makePost({ format: 'markdown', body })
    expect(extractFirstImageUrl(post)).toBe('https://cdn.example.com/a.webp')
  })

  it('returns null when there is no image', () => {
    const post = makePost({ format: 'markdown', body: 'plain text only' })
    expect(extractFirstImageUrl(post)).toBeNull()
  })

  it('returns null when body is not a string', () => {
    const post = makePost({ format: 'markdown', body: { not: 'string' } })
    expect(extractFirstImageUrl(post)).toBeNull()
  })
})

describe('extractFirstImageUrl — html', () => {
  it('finds the first <img src="..."> tag', () => {
    const body =
      '<p>before</p><img src="https://cdn.example.com/a.webp" alt="a" /><img src="https://cdn.example.com/b.webp" />'
    const post = makePost({ format: 'html', body })
    expect(extractFirstImageUrl(post)).toBe('https://cdn.example.com/a.webp')
  })

  it('accepts single-quoted src and is case-insensitive on the tag', () => {
    const body = "<P>x</P><IMG SRC='https://cdn.example.com/c.png' />"
    const post = makePost({ format: 'html', body })
    expect(extractFirstImageUrl(post)).toBe('https://cdn.example.com/c.png')
  })

  it('returns null when there is no img tag', () => {
    const post = makePost({ format: 'html', body: '<p>nothing here</p>' })
    expect(extractFirstImageUrl(post)).toBeNull()
  })

  it('returns null when body is not a string', () => {
    const post = makePost({ format: 'html', body: 123 })
    expect(extractFirstImageUrl(post)).toBeNull()
  })
})
