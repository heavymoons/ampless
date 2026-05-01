import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { AmplessEvent } from 'ampless'
import webhookPlugin from './index.js'

const SAMPLE_EVENT: AmplessEvent<'content.published'> = {
  type: 'content.published',
  payload: {
    siteId: 'default',
    postId: 'p1',
    slug: 'hello',
    title: 'Hello',
    status: 'published',
  },
  timestamp: '2026-04-30T00:00:00.000Z',
}

const PLUGIN_CTX = {
  siteId: 'default',
  site: { name: 'Test', url: 'https://example.com' },
  listPublishedPosts: async () => {
    throw new Error('unused')
  },
  writePublicAsset: async () => {
    throw new Error('unused')
  },
}

describe('webhookPlugin', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes hooks for every content.* event by default', () => {
    const plugin = webhookPlugin({ url: 'https://example.com/hook' })
    const eventTypes = Object.keys(plugin.hooks ?? {}).sort()
    expect(eventTypes).toEqual(
      [
        'content.created',
        'content.deleted',
        'content.published',
        'content.unpublished',
        'content.updated',
      ].sort()
    )
  })

  it('only registers hooks for filtered events', () => {
    const plugin = webhookPlugin({
      endpoints: [{ url: 'https://example.com/hook', events: ['content.published'] }],
    })
    expect(Object.keys(plugin.hooks ?? {})).toEqual(['content.published'])
  })

  it('POSTs the JSON envelope to a single endpoint', async () => {
    const plugin = webhookPlugin({ url: 'https://example.com/hook' })
    await plugin.hooks!['content.published']!(SAMPLE_EVENT, PLUGIN_CTX)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://example.com/hook')
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({
      type: 'content.published',
      payload: SAMPLE_EVENT.payload,
      timestamp: SAMPLE_EVENT.timestamp,
    })
  })

  it('attaches the X-Ampless-Signature header when a secret is set', async () => {
    const plugin = webhookPlugin({ url: 'https://example.com/hook', secret: 'shh' })
    await plugin.hooks!['content.published']!(SAMPLE_EVENT, PLUGIN_CTX)
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>
    expect(headers['X-Ampless-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/)
    expect(headers['X-Ampless-Event']).toBe('content.published')
  })

  it('omits the signature header when no secret is set', async () => {
    const plugin = webhookPlugin({ url: 'https://example.com/hook' })
    await plugin.hooks!['content.published']!(SAMPLE_EVENT, PLUGIN_CTX)
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>
    expect(headers['X-Ampless-Signature']).toBeUndefined()
  })

  it('fans out to multiple endpoints in parallel', async () => {
    const plugin = webhookPlugin({
      endpoints: [
        { url: 'https://a.example/hook' },
        { url: 'https://b.example/hook' },
      ],
    })
    await plugin.hooks!['content.published']!(SAMPLE_EVENT, PLUGIN_CTX)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const urls = fetchMock.mock.calls.map((c) => c[0]).sort()
    expect(urls).toEqual(['https://a.example/hook', 'https://b.example/hook'])
  })

  it('skips endpoints whose event filter excludes the current type', async () => {
    const plugin = webhookPlugin({
      endpoints: [
        { url: 'https://a.example', events: ['content.deleted'] },
        { url: 'https://b.example', events: ['content.published'] },
      ],
    })
    await plugin.hooks!['content.published']!(SAMPLE_EVENT, PLUGIN_CTX)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe('https://b.example')
  })

  it('throws (so SQS retries) when an endpoint returns non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }))
    const plugin = webhookPlugin({ url: 'https://example.com/hook' })
    await expect(
      plugin.hooks!['content.published']!(SAMPLE_EVENT, PLUGIN_CTX)
    ).rejects.toThrow(/500/)
  })

  it('throws when one endpoint fails even if another succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
    const plugin = webhookPlugin({
      endpoints: [{ url: 'https://a.example' }, { url: 'https://b.example' }],
    })
    await expect(
      plugin.hooks!['content.published']!(SAMPLE_EVENT, PLUGIN_CTX)
    ).rejects.toThrow(/500/)
  })
})
