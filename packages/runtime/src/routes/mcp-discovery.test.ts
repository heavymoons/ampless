import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'

import { createMcpDiscoveryRouteHandlers } from './mcp-discovery.js'
import { resolvePublicMcpIdentity } from './_mcp-shared.js'
import { createPublicMcpRouteHandler, _resetPublicMcpRateLimit } from './public-mcp.js'
import type { Ampless } from '../index.js'
import { SUPPORTED_PROTOCOL_VERSIONS } from '@ampless/mcp-server/jsonrpc'

// --- vendored Server Card schema ----------------------------------------
//
// `server-card.schema.json` is vendored verbatim from
//   modelcontextprotocol/experimental-ext-server-card
//   commit 3b2d974dbbc1bcf899e0ed2ef49a91758853c9a6
//   raw path: /schema.json
//   fetched: 2026-07-18
// It is a JSON Schema Draft 2020-12 whose usable definition lives at
// `#/$defs/ServerCard` (the document root itself is unconstrained), so we
// validate with the official validator's stack — `Ajv2020` + `ajv-formats`
// — and `getSchema` the `$defs.ServerCard` subschema. A plain `Ajv` on the
// root would no-op.
const schemaPath = fileURLToPath(
  new URL('./__fixtures__/server-card.schema.json', import.meta.url),
)
const cardSchema = JSON.parse(readFileSync(schemaPath, 'utf-8'))

function makeCardValidator() {
  const ajv = new Ajv2020({ strict: false, allErrors: true })
  addFormats(ajv)
  ajv.addSchema(cardSchema, 'server-card')
  const validate = ajv.getSchema('server-card#/$defs/ServerCard')
  if (!validate) throw new Error('could not resolve #/$defs/ServerCard from the vendored schema')
  return validate
}

// --- fixtures -----------------------------------------------------------

interface MockOpts {
  publicMcp?: boolean
  mcpDiscovery?: boolean
  siteUrl?: string
  siteName?: string
}

function makeAmpless(opts: MockOpts = {}): Ampless {
  const loadSiteSettings = vi.fn(async () => ({
    site: {
      name: opts.siteName ?? 'Example Site',
      url: opts.siteUrl ?? 'https://example.com',
    },
    media: {},
  }))
  return {
    cmsConfig: { ai: { publicMcp: opts.publicMcp, mcpDiscovery: opts.mcpDiscovery } },
    loadSiteSettings,
  } as unknown as Ampless
}

const BOTH_ON: MockOpts = { publicMcp: true, mcpDiscovery: true }

function req(path: string): Request {
  return new Request(`https://example.com${path}`)
}

function expectCors(res: Response): void {
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS')
}

// --- resolvePublicMcpIdentity (unit) ------------------------------------

describe('resolvePublicMcpIdentity', () => {
  it('reverses hostname labels into a reverse-DNS Card name', () => {
    expect(resolvePublicMcpIdentity('https://ishinao.net')).toEqual({
      name: 'net.ishinao/ampless-mcp',
      version: '0.2.0',
    })
    expect(resolvePublicMcpIdentity('https://blog.example.com/base')).toEqual({
      name: 'com.example.blog/ampless-mcp',
      version: '0.2.0',
    })
  })

  it('punycodes an IDN hostname before reversing', () => {
    // 日本.example → xn--wgv71a.example → reversed
    expect(resolvePublicMcpIdentity('https://日本.example')).toEqual({
      name: 'example.xn--wgv71a/ampless-mcp',
      version: '0.2.0',
    })
  })

  it('returns null for missing / blank / non-http(s) site URLs', () => {
    expect(resolvePublicMcpIdentity(undefined)).toBeNull()
    expect(resolvePublicMcpIdentity('   ')).toBeNull()
    expect(resolvePublicMcpIdentity('ftp://example.com')).toBeNull()
    expect(resolvePublicMcpIdentity('not a url')).toBeNull()
  })

  it('documents localhost + IPv4 behaviour: pattern-valid, so allowed', () => {
    // Single-label localhost reverses to itself; matches the Card name pattern.
    expect(resolvePublicMcpIdentity('http://localhost:3000')).toEqual({
      name: 'localhost/ampless-mcp',
      version: '0.2.0',
    })
    // IPv4 octets reverse; digits + dots satisfy the namespace char class.
    expect(resolvePublicMcpIdentity('http://127.0.0.1:3000')).toEqual({
      name: '1.0.0.127/ampless-mcp',
      version: '0.2.0',
    })
  })

  it('returns null for an IPv6 host (brackets/colons fail the name pattern)', () => {
    expect(resolvePublicMcpIdentity('http://[::1]:3000')).toBeNull()
  })

  it('returns null when a very long hostname would exceed the 200-char name cap', () => {
    const longHost = 'a'.repeat(190) + '.com' // reversed name → 206 chars > 200
    const identity = resolvePublicMcpIdentity(`https://${longHost}`)
    expect(identity).toBeNull()
  })

  it('produces a name that satisfies the vendored Card schema pattern', () => {
    const validate = makeCardValidator()
    const identity = resolvePublicMcpIdentity('https://sub.example.co.jp')
    expect(identity).not.toBeNull()
    const card = {
      $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
      name: identity!.name,
      version: identity!.version,
      description: 'x',
    }
    expect(validate(card)).toBe(true)
  })
})

// --- route handlers -----------------------------------------------------

describe('createMcpDiscoveryRouteHandlers', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // --- gate ---

  describe('gate (ai.publicMcp && ai.mcpDiscovery)', () => {
    it.each([
      ['both off', {}],
      ['publicMcp off, discovery on', { mcpDiscovery: true }],
      ['publicMcp on, discovery off', { publicMcp: true }],
    ])('catalog + server-card 404 when %s', async (_label, flags) => {
      const { catalog, serverCard } = createMcpDiscoveryRouteHandlers(makeAmpless(flags))
      const c = await catalog.GET(req('/api/mcp/catalog.json'))
      const s = await serverCard.GET(req('/api/mcp/server-card'))
      expect(c.status).toBe(404)
      expect(s.status).toBe(404)
      expectCors(c)
      expectCors(s)
    })

    it('does NOT call loadSiteSettings when the flag pair is off (sync gate first)', async () => {
      const ampless = makeAmpless({ publicMcp: true }) // discovery off
      const { catalog, serverCard } = createMcpDiscoveryRouteHandlers(ampless)
      await catalog.GET(req('/api/mcp/catalog.json'))
      await serverCard.GET(req('/api/mcp/server-card'))
      expect(ampless.loadSiteSettings).not.toHaveBeenCalled()
    })

    it('404s + warns when both flags are on but site.url is unresolvable', async () => {
      const ampless = makeAmpless({ ...BOTH_ON, siteUrl: '' })
      const { catalog, serverCard } = createMcpDiscoveryRouteHandlers(ampless)
      const c = await catalog.GET(req('/api/mcp/catalog.json'))
      const s = await serverCard.GET(req('/api/mcp/server-card'))
      expect(c.status).toBe(404)
      expect(s.status).toBe(404)
      expect(ampless.loadSiteSettings).toHaveBeenCalled()
      expect(console.warn).toHaveBeenCalled()
    })

    it('404s when both flags are on but the hostname is too long for a valid Card name', async () => {
      const longHost = 'a'.repeat(190) + '.com'
      const { serverCard } = createMcpDiscoveryRouteHandlers(
        makeAmpless({ ...BOTH_ON, siteUrl: `https://${longHost}` }),
      )
      const s = await serverCard.GET(req('/api/mcp/server-card'))
      expect(s.status).toBe(404)
    })

    it('OPTIONS 204 when enabled, 404 when the gate is off', async () => {
      const on = createMcpDiscoveryRouteHandlers(makeAmpless(BOTH_ON))
      const off = createMcpDiscoveryRouteHandlers(makeAmpless({ publicMcp: true }))
      const onCat = await on.catalog.OPTIONS(req('/api/mcp/catalog.json'))
      const onCard = await on.serverCard.OPTIONS(req('/api/mcp/server-card'))
      expect(onCat.status).toBe(204)
      expect(onCard.status).toBe(204)
      expectCors(onCat)
      const offCat = await off.catalog.OPTIONS(req('/api/mcp/catalog.json'))
      expect(offCat.status).toBe(404)
    })
  })

  // --- catalog ---

  describe('catalog', () => {
    it('serves the catalog shape with a single Server Card entry', async () => {
      const { catalog } = createMcpDiscoveryRouteHandlers(
        makeAmpless({ ...BOTH_ON, siteUrl: 'https://example.com' }),
      )
      const res = await catalog.GET(req('/api/mcp/catalog.json'))
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('application/json')
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600')
      expectCors(res)
      const body = await res.json()
      expect(body.specVersion).toBe('draft')
      expect(body.entries).toHaveLength(1)
      expect(body.entries[0]).toEqual({
        identifier: 'urn:air:example.com:ampless-mcp',
        type: 'application/mcp-server-card+json',
        url: 'https://example.com/api/mcp/server-card',
      })
    })

    it('advertises the origin of site.url, dropping any path component', async () => {
      const { catalog } = createMcpDiscoveryRouteHandlers(
        makeAmpless({ ...BOTH_ON, siteUrl: 'https://example.com/base/' }),
      )
      const body = await (await catalog.GET(req('/api/mcp/catalog.json'))).json()
      expect(body.entries[0].url).toBe('https://example.com/api/mcp/server-card')
      expect(body.entries[0].identifier).toBe('urn:air:example.com:ampless-mcp')
    })

    it('never leaks userinfo credentials embedded in site.url', async () => {
      const { catalog } = createMcpDiscoveryRouteHandlers(
        makeAmpless({ ...BOTH_ON, siteUrl: 'https://user:secret@example.com' }),
      )
      const res = await catalog.GET(req('/api/mcp/catalog.json'))
      const raw = await res.text()
      expect(raw).not.toContain('user')
      expect(raw).not.toContain('secret')
      expect(raw).not.toContain('@')
      const body = JSON.parse(raw)
      expect(body.entries[0].url).toBe('https://example.com/api/mcp/server-card')
    })
  })

  // --- server card ---

  describe('server-card', () => {
    it('serves a Card that validates against the vendored schema', async () => {
      const validate = makeCardValidator()
      const { serverCard } = createMcpDiscoveryRouteHandlers(
        makeAmpless({ ...BOTH_ON, siteUrl: 'https://ishinao.net', siteName: 'ishinao.net' }),
      )
      const res = await serverCard.GET(req('/api/mcp/server-card'))
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('application/mcp-server-card+json')
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600')
      expectCors(res)
      const card = await res.json()
      const ok = validate(card)
      expect(validate.errors).toBeNull()
      expect(ok).toBe(true)

      expect(card.$schema).toBe(
        'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
      )
      expect(card.name).toBe('net.ishinao/ampless-mcp')
      expect(card.version).toBe('0.2.0')
      expect(card.websiteUrl).toBe('https://ishinao.net')
      expect(card.remotes).toEqual([
        {
          type: 'streamable-http',
          url: 'https://ishinao.net/api/mcp',
          supportedProtocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
        },
      ])
    })

    it('never leaks userinfo credentials embedded in site.url', async () => {
      const { serverCard } = createMcpDiscoveryRouteHandlers(
        makeAmpless({ ...BOTH_ON, siteUrl: 'https://user:secret@example.com' }),
      )
      const res = await serverCard.GET(req('/api/mcp/server-card'))
      const raw = await res.text()
      expect(raw).not.toContain('user')
      expect(raw).not.toContain('secret')
      expect(raw).not.toContain('@')
      const card = JSON.parse(raw)
      expect(card.websiteUrl).toBe('https://example.com')
      expect(card.remotes[0].url).toBe('https://example.com/api/mcp')
    })

    it('never leaks internal post fields', async () => {
      const { serverCard } = createMcpDiscoveryRouteHandlers(makeAmpless(BOTH_ON))
      const raw = await (await serverCard.GET(req('/api/mcp/server-card'))).text()
      for (const forbidden of ['postId', 'status', 'draft', 'metadata', 'token']) {
        expect(raw).not.toContain(forbidden)
      }
    })

    it('collapses newlines in site.name and truncates title/description to 100 chars', async () => {
      const validate = makeCardValidator()
      const longName = 'A'.repeat(60) + '\n\t ' + 'B'.repeat(120)
      const { serverCard } = createMcpDiscoveryRouteHandlers(
        makeAmpless({ ...BOTH_ON, siteName: longName }),
      )
      const card = await (await serverCard.GET(req('/api/mcp/server-card'))).json()
      expect(validate(card)).toBe(true)
      expect(card.title.length).toBeLessThanOrEqual(100)
      expect(card.description.length).toBeLessThanOrEqual(100)
      // Newlines/tabs collapsed to single spaces.
      expect(card.title).not.toMatch(/[\n\t]/)
      expect(card.title.startsWith('A'.repeat(60) + ' B')).toBe(true)
    })

    it('truncates by code point, not UTF-16 unit, when a surrogate pair straddles the 100-char cap', async () => {
      const validate = makeCardValidator()
      // The 100th code point (index 99) is a surrogate-pair emoji — a
      // naive `.slice(0, 100)` on UTF-16 units would cut it in half,
      // leaving a lone (ill-formed) surrogate in the JSON output.
      const longName = 'A'.repeat(99) + '\u{1F600}' + 'C'.repeat(60) // 😀
      const { serverCard } = createMcpDiscoveryRouteHandlers(
        makeAmpless({ ...BOTH_ON, siteName: longName }),
      )
      const card = await (await serverCard.GET(req('/api/mcp/server-card'))).json()
      expect(validate(card)).toBe(true)

      expect([...card.title].length).toBeLessThanOrEqual(100)
      expect([...card.description].length).toBeLessThanOrEqual(100)
      expect(card.title.isWellFormed()).toBe(true)
      expect(card.description.isWellFormed()).toBe(true)
      // The emoji at code point 100 must survive intact, not as a lone
      // surrogate.
      expect(card.title.endsWith('\u{1F600}')).toBe(true)

      // Round-tripping through JSON.stringify/parse (as the route itself
      // does) must not throw or produce U+FFFD replacement characters.
      const roundTripped = JSON.parse(JSON.stringify(card))
      expect(roundTripped.title).toBe(card.title)
      expect(roundTripped.title).not.toContain('�')
    })

    it('omits title (but keeps a non-empty description) when site.name is empty', async () => {
      const validate = makeCardValidator()
      const { serverCard } = createMcpDiscoveryRouteHandlers(
        makeAmpless({ ...BOTH_ON, siteName: '   ' }),
      )
      const card = await (await serverCard.GET(req('/api/mcp/server-card'))).json()
      expect(validate(card)).toBe(true)
      expect(card).not.toHaveProperty('title')
      expect(typeof card.description).toBe('string')
      expect(card.description.length).toBeGreaterThan(0)
    })

    // --- negative control: the validator actually rejects bad cards ---
    describe('AJV negative control', () => {
      const validate = makeCardValidator()
      it('rejects a card missing `name`', () => {
        expect(
          validate({
            $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
            version: '0.2.0',
            description: 'x',
          }),
        ).toBe(false)
      })
      it('rejects an empty `title` (minLength 1)', () => {
        expect(
          validate({
            $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
            name: 'net.ishinao/ampless-mcp',
            version: '0.2.0',
            description: 'x',
            title: '',
          }),
        ).toBe(false)
      })
      it('rejects a `name` that fails the reverse-DNS pattern (no slash)', () => {
        expect(
          validate({
            $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
            name: 'not-reverse-dns',
            version: '0.2.0',
            description: 'x',
          }),
        ).toBe(false)
      })
    })
  })

  // --- Card / live server identity agreement ---

  it('Card name/version deep-equals the /api/mcp initialize serverInfo', async () => {
    _resetPublicMcpRateLimit()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // A fake ampless that backs both the discovery routes and the JSON-RPC
    // endpoint, with both flags on and the same site.url.
    const loadSiteSettings = vi.fn(async () => ({
      site: { name: 'ishinao.net', url: 'https://ishinao.net' },
      media: {},
    }))
    const ampless = {
      cmsConfig: { ai: { publicMcp: true, mcpDiscovery: true } },
      loadSiteSettings,
      listPublishedPosts: vi.fn(async () => ({ items: [], nextToken: null })),
      getPublishedPost: vi.fn(async () => null),
      postToMarkdown: vi.fn(async () => ''),
    } as unknown as Ampless

    const { serverCard } = createMcpDiscoveryRouteHandlers(ampless)
    const card = await (await serverCard.GET(req('/api/mcp/server-card'))).json()

    const { POST } = createPublicMcpRouteHandler(ampless)
    const initRes = await POST(
      new Request('https://ishinao.net/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-03-26' },
        }),
      }),
    )
    const initBody = await initRes.json()
    expect(initBody.result.serverInfo).toEqual({
      name: card.name,
      version: card.version,
    })
    expect(initBody.result.serverInfo).toEqual({ name: 'net.ishinao/ampless-mcp', version: '0.2.0' })
  })
})
