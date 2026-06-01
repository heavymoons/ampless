import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { AmplessEvent } from 'ampless'
import webhookPlugin from './index.js'

const SAMPLE_EVENT: AmplessEvent<'content.published'> = {
  type: 'content.published',
  payload: {
    postId: 'p1',
    slug: 'hello',
    title: 'Hello',
    status: 'published',
  },
  timestamp: '2026-04-30T00:00:00.000Z',
}

/** Build a mock TrustedPluginRuntimeContext for tests. */
function makeTrustedCtx(adminSecret?: string) {
  return {
    site: { name: 'Test', url: 'https://example.com' },
    listPublishedPosts: async () => {
      throw new Error('unused')
    },
    writePublicAsset: async () => {
      throw new Error('unused')
    },
    secret: async (key: string) => {
      if (key === 'signingSecret') return adminSecret
      return undefined
    },
  }
}

/** Default ctx: no admin secret saved yet (backward-compat baseline). */
const PLUGIN_CTX = makeTrustedCtx(undefined)

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
    const plugin = webhookPlugin({ endpoints: [{ url: 'https://example.com/hook' }] })
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
    const plugin = webhookPlugin({ endpoints: [{ url: 'https://example.com/hook' }] })
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
    const plugin = webhookPlugin({ endpoints: [{ url: 'https://example.com/hook', secret: 'shh' }] })
    await plugin.hooks!['content.published']!(SAMPLE_EVENT, PLUGIN_CTX)
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>
    expect(headers['X-Ampless-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/)
    expect(headers['X-Ampless-Event']).toBe('content.published')
  })

  it('omits the signature header when no secret is set', async () => {
    const plugin = webhookPlugin({ endpoints: [{ url: 'https://example.com/hook' }] })
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
    const plugin = webhookPlugin({ endpoints: [{ url: 'https://example.com/hook' }] })
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

// ---------------------------------------------------------------------------
// Phase 6a: trusted + secretSettings
// ---------------------------------------------------------------------------

describe('webhookPlugin — Phase 6a shape', () => {
  it('has trust_level: trusted', () => {
    const plugin = webhookPlugin({ endpoints: [{ url: 'https://example.com/hook' }] })
    expect(plugin.trust_level).toBe('trusted')
  })

  it('declares eventHooks and secretSettings capabilities', () => {
    const plugin = webhookPlugin({ endpoints: [{ url: 'https://example.com/hook' }] })
    expect(plugin.capabilities).toContain('eventHooks')
    expect(plugin.capabilities).toContain('secretSettings')
  })

  it('has settings.secret with a signingSecret text field', () => {
    const plugin = webhookPlugin({ endpoints: [{ url: 'https://example.com/hook' }] })
    const field = plugin.settings?.secret?.[0]
    expect(field).toBeDefined()
    expect(field?.type).toBe('text')
    expect(field?.key).toBe('signingSecret')
  })

  it('settings.secret[0] does not have a default property', () => {
    const plugin = webhookPlugin({ endpoints: [{ url: 'https://example.com/hook' }] })
    const field = plugin.settings?.secret?.[0] as Record<string, unknown>
    expect(Object.prototype.hasOwnProperty.call(field, 'default')).toBe(false)
  })
})

describe('webhookPlugin — admin secret routing', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses admin secret for all endpoints when admin secret is set (overrides per-endpoint secret)', async () => {
    const plugin = webhookPlugin({
      endpoints: [
        { url: 'https://a.example', secret: 'old-a' },
        { url: 'https://b.example', secret: 'old-b' },
      ],
    })
    const ctx = makeTrustedCtx('admin-secret-xxx')
    await plugin.hooks!['content.published']!(SAMPLE_EVENT, ctx)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const call of fetchMock.mock.calls) {
      const headers = (call[1] as RequestInit).headers as Record<string, string>
      // Signature must exist and be derived from 'admin-secret-xxx'
      expect(headers['X-Ampless-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/)
    }

    // Verify both endpoints use the *same* admin-derived signature
    const sigs = fetchMock.mock.calls.map(
      (c) => ((c[1] as RequestInit).headers as Record<string, string>)['X-Ampless-Signature']
    )
    expect(sigs[0]).toBe(sigs[1])
  })

  it('falls back to per-endpoint constructor secret when admin secret is undefined', async () => {
    const plugin = webhookPlugin({
      endpoints: [
        { url: 'https://a.example', secret: 'secret-a' },
        { url: 'https://b.example', secret: 'secret-b' },
      ],
    })
    // No admin secret
    const ctx = makeTrustedCtx(undefined)
    await plugin.hooks!['content.published']!(SAMPLE_EVENT, ctx)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    // Both should still have signatures (from per-endpoint secrets)
    for (const call of fetchMock.mock.calls) {
      const headers = (call[1] as RequestInit).headers as Record<string, string>
      expect(headers['X-Ampless-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/)
    }

    // The two endpoints have different secrets, so signatures must differ
    const sigs = fetchMock.mock.calls.map(
      (c) => ((c[1] as RequestInit).headers as Record<string, string>)['X-Ampless-Signature']
    )
    expect(sigs[0]).not.toBe(sigs[1])
  })

  it('omits signature when neither admin secret nor endpoint secret is set', async () => {
    const plugin = webhookPlugin({
      endpoints: [{ url: 'https://example.com/hook' }],
    })
    const ctx = makeTrustedCtx(undefined)
    await plugin.hooks!['content.published']!(SAMPLE_EVENT, ctx)

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>
    expect(headers['X-Ampless-Signature']).toBeUndefined()
  })

  it('2 endpoints with different constructor secrets + admin secret set: both use admin secret', async () => {
    const plugin = webhookPlugin({
      endpoints: [
        { url: 'https://x.example', secret: 'secret-x' },
        { url: 'https://y.example', secret: 'secret-y' },
      ],
    })
    const ctx = makeTrustedCtx('unified-admin-key')
    await plugin.hooks!['content.published']!(SAMPLE_EVENT, ctx)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const sigs = fetchMock.mock.calls.map(
      (c) => ((c[1] as RequestInit).headers as Record<string, string>)['X-Ampless-Signature']
    )
    // Both must have signatures
    expect(sigs[0]).toMatch(/^sha256=[0-9a-f]{64}$/)
    expect(sigs[1]).toMatch(/^sha256=[0-9a-f]{64}$/)
    // Both are identical (same admin key, same body)
    expect(sigs[0]).toBe(sigs[1])
  })

  it('2 endpoints with different constructor secrets + no admin secret: each uses own secret', async () => {
    const plugin = webhookPlugin({
      endpoints: [
        { url: 'https://x.example', secret: 'secret-x' },
        { url: 'https://y.example', secret: 'secret-y' },
      ],
    })
    const ctx = makeTrustedCtx(undefined)
    await plugin.hooks!['content.published']!(SAMPLE_EVENT, ctx)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const sigs = fetchMock.mock.calls.map(
      (c) => ((c[1] as RequestInit).headers as Record<string, string>)['X-Ampless-Signature']
    )
    expect(sigs[0]).toMatch(/^sha256=[0-9a-f]{64}$/)
    expect(sigs[1]).toMatch(/^sha256=[0-9a-f]{64}$/)
    // Different constructor secrets → different signatures
    expect(sigs[0]).not.toBe(sigs[1])
  })
})
