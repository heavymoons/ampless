import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadImageForOg } from './load-image.js'

type FetchMock = ReturnType<typeof vi.fn>

let realFetch: typeof fetch

function mockFetch(response: Response | (() => Promise<Response>)): FetchMock {
  const fn = vi.fn(typeof response === 'function' ? response : async () => response) as FetchMock
  global.fetch = fn as unknown as typeof fetch
  return fn
}

function pngBytes(): Uint8Array {
  // Minimal valid PNG byte sequence is not required — loadImageForOg
  // passes through PNG/JPEG by content-type without decoding.
  return new Uint8Array([1, 2, 3, 4])
}

beforeEach(() => {
  realFetch = global.fetch
})

afterEach(() => {
  global.fetch = realFetch
  vi.restoreAllMocks()
})

describe('loadImageForOg', () => {
  it('passes PNG through as a data URL without decoding', async () => {
    mockFetch(
      new Response(pngBytes(), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    )
    const out = await loadImageForOg('https://example.com/a.png')
    expect(out).toMatch(/^data:image\/png;base64,/)
  })

  it('passes JPEG through as a data URL without decoding', async () => {
    mockFetch(
      new Response(pngBytes(), {
        status: 200,
        headers: { 'content-type': 'image/jpeg; charset=binary' },
      })
    )
    const out = await loadImageForOg('https://example.com/a.jpg')
    expect(out).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('returns null for GIF (unsupported by Satori)', async () => {
    mockFetch(
      new Response(pngBytes(), {
        status: 200,
        headers: { 'content-type': 'image/gif' },
      })
    )
    const out = await loadImageForOg('https://example.com/a.gif')
    expect(out).toBeNull()
  })

  it('returns null for SVG', async () => {
    mockFetch(
      new Response('<svg/>', {
        status: 200,
        headers: { 'content-type': 'image/svg+xml' },
      })
    )
    const out = await loadImageForOg('https://example.com/a.svg')
    expect(out).toBeNull()
  })

  it('returns null on fetch failure', async () => {
    mockFetch(async () => {
      throw new Error('boom')
    })
    // Suppress the expected error log so test output stays quiet.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await loadImageForOg('https://example.com/a.webp')
    expect(out).toBeNull()
  })

  it('returns null on non-ok HTTP status', async () => {
    mockFetch(
      new Response('not found', {
        status: 404,
        headers: { 'content-type': 'image/png' },
      })
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await loadImageForOg('https://example.com/a.png')
    expect(out).toBeNull()
  })

  it('returns null when content-type is missing', async () => {
    mockFetch(new Response(pngBytes(), { status: 200 }))
    const out = await loadImageForOg('https://example.com/unknown')
    expect(out).toBeNull()
  })
})
