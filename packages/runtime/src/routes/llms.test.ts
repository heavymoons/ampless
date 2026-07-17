import { describe, it, expect, vi } from 'vitest'
import { marked, type Tokens, type Token } from 'marked'
import type { Config, Post } from 'ampless'

import { createLlmsTxtRouteHandler } from './llms.js'
import type { Ampless } from '../index.js'
import type { ListPostsOptions, ListPostsResult } from '../posts.js'

const BASE_CONFIG: Config = { site: { name: 'Site Name', url: 'https://x.example.com' } }

interface SettingsOverrides {
  name?: string
  url?: string
  description?: string
}

type ListImpl = (opts?: ListPostsOptions) => ListPostsResult | Promise<ListPostsResult>

interface MockAmplessOpts {
  cmsConfig?: Config
  settings?: SettingsOverrides
  list: ListImpl
}

function makeAmpless({ cmsConfig = BASE_CONFIG, settings = {}, list }: MockAmplessOpts): Ampless {
  return {
    cmsConfig,
    listPublishedPosts: vi.fn(list),
    loadSiteSettings: vi.fn(async () => ({
      site: {
        name: settings.name ?? 'Site Name',
        url: settings.url ?? 'https://x.example.com',
        description: settings.description,
      },
      media: {},
    })),
  } as unknown as Ampless
}

function makeRequest(url = 'https://x.example.com/llms.txt'): Request {
  return new Request(url)
}

function makeCtx() {
  return { params: Promise.resolve({}) }
}

let seq = 0
function makePost(overrides: Partial<Post> = {}): Post {
  seq += 1
  return {
    postId: `p${seq}`,
    slug: `post-${seq}`,
    title: `Post ${seq}`,
    format: 'markdown',
    body: 'body',
    status: 'published',
    ...overrides,
  }
}

// Turns a fixed sequence of `{ items, nextToken }` pages into a
// `listPublishedPosts` stub, served in call order regardless of the
// `nextToken` the caller passes back in (the route always passes
// through whatever the previous page returned, so this is faithful to
// how the real API is driven).
function sequentialPages(pages: ListPostsResult[]): ListImpl {
  let i = 0
  return () => {
    const page = pages[i] ?? { items: [], nextToken: null }
    i += 1
    return page
  }
}

// Recursively collects `link` tokens out of a marked token tree —
// list items nest their inline content under `.tokens`, and lists
// nest their items under `.items`.
function collectLinks(node: unknown, out: Token[] = []): Token[] {
  if (!node) return out
  if (Array.isArray(node)) {
    for (const n of node) collectLinks(n, out)
    return out
  }
  if (typeof node !== 'object') return out
  const t = node as { type?: string; tokens?: unknown; items?: unknown }
  if (t.type === 'link') out.push(node as Token)
  if (t.tokens) collectLinks(t.tokens, out)
  if (t.items) collectLinks(t.items, out)
  return out
}

describe('createLlmsTxtRouteHandler', () => {
  it('404s when ai.llmsTxt is false', async () => {
    const ampless = makeAmpless({
      cmsConfig: { ...BASE_CONFIG, ai: { llmsTxt: false } },
      list: sequentialPages([{ items: [], nextToken: null }]),
    })
    const handler = createLlmsTxtRouteHandler(ampless)
    const res = await handler(makeRequest(), makeCtx())
    expect(res.status).toBe(404)
    expect(ampless.listPublishedPosts).not.toHaveBeenCalled()
  })

  it('200s when ai.llmsTxt is unset', async () => {
    const ampless = makeAmpless({ list: sequentialPages([{ items: [], nextToken: null }]) })
    const handler = createLlmsTxtRouteHandler(ampless)
    const res = await handler(makeRequest(), makeCtx())
    expect(res.status).toBe(200)
  })

  it('advertises the public MCP endpoint in the preamble only when enabled', async () => {
    const posts = [makePost()]
    const enabled = makeAmpless({
      cmsConfig: { ...BASE_CONFIG, ai: { publicMcp: true } },
      settings: { url: 'https://site.example.com/base/' },
      list: sequentialPages([{ items: posts, nextToken: null }]),
    })
    const enabledText = await (
      await createLlmsTxtRouteHandler(enabled)(makeRequest(), makeCtx())
    ).text()
    // Origin-based (matching admin's resolvePublicMcpEndpoint): the /base
    // path in site.url must NOT leak into the MCP endpoint URL.
    const guidance =
      'This site also exposes a read-only MCP endpoint at https://site.example.com/api/mcp ' +
      '(JSON-RPC over HTTP POST; tools: list_posts, get_post, search_posts, list_tags; published posts only).'
    expect(enabledText).toContain(guidance)
    expect(enabledText.indexOf(guidance)).toBeLessThan(enabledText.indexOf('## Posts'))

    const disabled = makeAmpless({
      cmsConfig: { ...BASE_CONFIG, ai: { publicMcp: false } },
      list: sequentialPages([{ items: posts, nextToken: null }]),
    })
    const disabledText = await (
      await createLlmsTxtRouteHandler(disabled)(makeRequest(), makeCtx())
    ).text()
    expect(disabledText).not.toContain('read-only MCP endpoint')
  })

  it('builds the MCP endpoint from the site URL origin even when site.url has a path', async () => {
    const post = makePost({ slug: 'hello', title: 'Hello' })
    const ampless = makeAmpless({
      cmsConfig: { ...BASE_CONFIG, ai: { publicMcp: true } },
      settings: { url: 'https://example.com/base' },
      list: sequentialPages([{ items: [post], nextToken: null }]),
    })
    const text = await (
      await createLlmsTxtRouteHandler(ampless)(makeRequest(), makeCtx())
    ).text()
    // MCP endpoint is origin-based — /base is dropped.
    expect(text).toContain('read-only MCP endpoint at https://example.com/api/mcp ')
    // Post links keep the path-based buildUrl behavior (unchanged).
    expect(text).toContain('[Hello](https://example.com/base/hello.md)')
  })

  it('uses a relative public MCP endpoint when the configured site URL is empty', async () => {
    const ampless = makeAmpless({
      cmsConfig: { ...BASE_CONFIG, ai: { publicMcp: true } },
      settings: { url: '' },
      list: sequentialPages([{ items: [], nextToken: null }]),
    })
    const text = await (
      await createLlmsTxtRouteHandler(ampless)(makeRequest(), makeCtx())
    ).text()
    expect(text).toContain('read-only MCP endpoint at /api/mcp ')
  })

  it('uses a relative public MCP endpoint when the site URL is not http(s) (e.g. ftp)', async () => {
    // `resolvePublicMcpEndpoint` (ampless core, shared with admin) rejects
    // non-http(s) protocols outright rather than mechanically resolving
    // `/api/mcp` against them — an `ftp://` (or similar) site URL must not
    // produce an `ftp://.../api/mcp` line in llms.txt.
    const ampless = makeAmpless({
      cmsConfig: { ...BASE_CONFIG, ai: { publicMcp: true } },
      settings: { url: 'ftp://example.com/base' },
      list: sequentialPages([{ items: [], nextToken: null }]),
    })
    const text = await (
      await createLlmsTxtRouteHandler(ampless)(makeRequest(), makeCtx())
    ).text()
    expect(text).toContain('read-only MCP endpoint at /api/mcp ')
    expect(text).not.toContain('ftp://')
  })

  it('sets Content-Type: text/plain and a self-computed Cache-Control', async () => {
    const ampless = makeAmpless({ list: sequentialPages([{ items: [], nextToken: null }]) })
    const handler = createLlmsTxtRouteHandler(ampless)
    const res = await handler(makeRequest(), makeCtx())
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('Cache-Control')).toBe(
      'public, max-age=300, s-maxage=3600, stale-while-revalidate=3600',
    )
  })

  it('renders # name and > description when present', async () => {
    const ampless = makeAmpless({
      settings: { name: 'My Site', description: 'A blog about things' },
      list: sequentialPages([{ items: [], nextToken: null }]),
    })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(text.startsWith('# My Site\n')).toBe(true)
    expect(text).toContain('> A blog about things')
  })

  it('omits the blockquote when description is absent', async () => {
    const ampless = makeAmpless({
      settings: { name: 'My Site' },
      list: sequentialPages([{ items: [], nextToken: null }]),
    })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(text).not.toContain('>')
  })

  it('omits the ## Posts section for an empty site', async () => {
    const ampless = makeAmpless({ list: sequentialPages([{ items: [], nextToken: null }]) })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(text).not.toContain('## Posts')
  })

  it('renders an entry with .md link, excerpt, and tags', async () => {
    const post = makePost({
      slug: 'hello-world',
      title: 'Hello World',
      excerpt: 'A nice excerpt.',
      tags: ['a', 'b'],
    })
    const ampless = makeAmpless({ list: sequentialPages([{ items: [post], nextToken: null }]) })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(text).toContain(
      '- [Hello World](https://x.example.com/hello-world.md): A nice excerpt. (tags: a, b)',
    )
  })

  it('omits ": excerpt" and "(tags: ...)" when absent', async () => {
    const post = makePost({ slug: 'bare', title: 'Bare Post', excerpt: undefined, tags: [] })
    const ampless = makeAmpless({ list: sequentialPages([{ items: [post], nextToken: null }]) })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(text).toContain('- [Bare Post](https://x.example.com/bare.md)\n')
  })

  it('tags-only (no excerpt): still leads with ": " so the description separator is present', async () => {
    const post = makePost({
      slug: 'tags-only',
      title: 'Tags Only',
      excerpt: undefined,
      tags: ['a', 'b'],
    })
    const ampless = makeAmpless({ list: sequentialPages([{ items: [post], nextToken: null }]) })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(text).toContain('- [Tags Only](https://x.example.com/tags-only.md): (tags: a, b)')
  })

  it('normalizes newlines/control characters and collapses whitespace in title, excerpt, tags, site name/description', async () => {
    const post = makePost({
      slug: 'ctrl',
      title: 'Title\nwith\tbreaks',
      excerpt: 'Excerpt\r\nwith  runs   of   space',
      tags: ['tag\none', 'tag\ttwo'],
    })
    const ampless = makeAmpless({
      settings: { name: 'Name\nHere', description: 'Desc\ttab' },
      list: sequentialPages([{ items: [post], nextToken: null }]),
    })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(text).toContain('# Name Here')
    expect(text).toContain('> Desc tab')
    expect(text).toContain('[Title with breaks]')
    expect(text).toContain('Excerpt with runs of space')
    expect(text).toContain('(tags: tag one, tag two)')
  })

  it('escapes [ and ] in link text as HTML entities', async () => {
    const post = makePost({ slug: 'brackets', title: 'Title [bracketed] here' })
    const ampless = makeAmpless({ list: sequentialPages([{ items: [post], nextToken: null }]) })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(text).toContain('[Title &#91;bracketed&#93; here]')
  })

  it('truncates excerpt to 200 chars with an ellipsis', async () => {
    const longExcerpt = 'x'.repeat(250)
    const post = makePost({ slug: 'long', title: 'Long', excerpt: longExcerpt })
    const ampless = makeAmpless({ list: sequentialPages([{ items: [post], nextToken: null }]) })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(text).toContain(': ' + 'x'.repeat(200) + '…')
    expect(text).not.toContain('x'.repeat(201))
  })

  it('fixed-encodes non-ASCII / RFC3986-reserved characters in the slug', async () => {
    const post = makePost({ slug: "café (v2)!'*", title: 'Weird slug' })
    const ampless = makeAmpless({ list: sequentialPages([{ items: [post], nextToken: null }]) })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    const expected =
      encodeURIComponent("café (v2)!'*").replace(
        /[!'()*]/g,
        (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
      ) + '.md'
    expect(text).toContain(`https://x.example.com/${expected}`)
    // No raw ( or ) survives into the URL — they'd break the markdown link.
    expect(text).not.toMatch(/\(v2\)/)
  })

  it('paginates: concatenates items across pages and requests Math.min(50, limit+1-collected) per page', async () => {
    const p1 = makePost()
    const p2 = makePost()
    const p3 = makePost()
    const ampless = makeAmpless({
      cmsConfig: { ...BASE_CONFIG, ai: { llmsTxt: { limit: 3 } } },
      list: sequentialPages([
        { items: [p1, p2], nextToken: 'A' },
        { items: [p3], nextToken: null },
      ]),
    })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    for (const p of [p1, p2, p3]) {
      expect(text).toContain(`[${p.title}]`)
    }
    const calls = (ampless.listPublishedPosts as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0]?.[0]?.limit).toBe(4) // min(50, 3+1-0)
    expect(calls[1]?.[0]?.limit).toBe(2) // min(50, 3+1-2)
    // Exactly `limit` items, token exhausted — no truncation note.
    expect(text).not.toContain('Note:')
  })

  it('limit+1 reached: truncates to `limit` items and emits the limit note in the description area', async () => {
    const posts = [makePost(), makePost(), makePost()]
    const ampless = makeAmpless({
      cmsConfig: { ...BASE_CONFIG, ai: { llmsTxt: { limit: 2 } } },
      list: sequentialPages([{ items: posts, nextToken: null }]),
    })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(text).toContain('Note: only the 2 most recent posts are listed; older posts are omitted.')
    expect(text).toContain(`[${posts[0]!.title}]`)
    expect(text).toContain(`[${posts[1]!.title}]`)
    expect(text).not.toContain(`[${posts[2]!.title}]`)
    // Note appears before the first H2.
    expect(text.indexOf('Note:')).toBeLessThan(text.indexOf('## Posts'))
  })

  it('exactly `limit` items with token exhausted: no truncation note', async () => {
    const posts = [makePost(), makePost()]
    const ampless = makeAmpless({
      cmsConfig: { ...BASE_CONFIG, ai: { llmsTxt: { limit: 2 } } },
      list: sequentialPages([{ items: posts, nextToken: null }]),
    })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(text).not.toContain('Note:')
  })

  it('token remains but the limit+1th item cannot actually be fetched: no truncation note', async () => {
    const posts = [makePost(), makePost()]
    const ampless = makeAmpless({
      cmsConfig: { ...BASE_CONFIG, ai: { llmsTxt: { limit: 2 } } },
      list: sequentialPages([
        { items: posts, nextToken: 'B' }, // exactly `limit`, but a token is present
        { items: [], nextToken: null }, // the "limit+1th" page turns out empty
      ]),
    })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(text).not.toContain('Note:')
    expect(ampless.listPublishedPosts).toHaveBeenCalledTimes(2)
  })

  it('MAX_PAGES cutoff: stops after 21 pages and emits the early-truncation note', async () => {
    const pages: ListPostsResult[] = Array.from({ length: 25 }, (_, i) => ({
      items: [makePost()],
      nextToken: `page-${i}`,
    }))
    const ampless = makeAmpless({
      cmsConfig: { ...BASE_CONFIG, ai: { llmsTxt: { limit: 100 } } },
      list: sequentialPages(pages),
    })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(ampless.listPublishedPosts).toHaveBeenCalledTimes(21)
    expect(text).toContain(
      'Note: this index was truncated early while scanning the post list; some older posts may be missing. Lower ai.llmsTxt.limit or reduce post sizes.',
    )
  })

  it('duplicate nextToken: stops the loop instead of looping forever, and emits the early-truncation note', async () => {
    let calls = 0
    const list: ListImpl = () => {
      calls += 1
      return { items: [makePost()], nextToken: 'DUPE' }
    }
    const ampless = makeAmpless({
      cmsConfig: { ...BASE_CONFIG, ai: { llmsTxt: { limit: 100 } } },
      list,
    })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(calls).toBe(2)
    expect(text).toContain('Note: this index was truncated early')
  })

  it('respects ai.llmsTxt.limit', async () => {
    const posts = [makePost(), makePost(), makePost()]
    const ampless = makeAmpless({
      cmsConfig: { ...BASE_CONFIG, ai: { llmsTxt: { limit: 1 } } },
      list: sequentialPages([{ items: posts, nextToken: null }]),
    })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(text).toContain(`[${posts[0]!.title}]`)
    expect(text).not.toContain(`[${posts[1]!.title}]`)
  })

  it('clamps limit: 0 -> 1', async () => {
    const posts = [makePost(), makePost()]
    const ampless = makeAmpless({
      cmsConfig: { ...BASE_CONFIG, ai: { llmsTxt: { limit: 0 } } },
      list: sequentialPages([{ items: posts, nextToken: null }]),
    })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(text).toContain(`[${posts[0]!.title}]`)
    expect(text).not.toContain(`[${posts[1]!.title}]`)
  })

  it('clamps limit: 10000 -> 1000 (first page request is still capped at 50)', async () => {
    const ampless = makeAmpless({
      cmsConfig: { ...BASE_CONFIG, ai: { llmsTxt: { limit: 10000 } } },
      list: sequentialPages([{ items: [], nextToken: null }]),
    })
    const handler = createLlmsTxtRouteHandler(ampless)
    await handler(makeRequest(), makeCtx())
    const calls = (ampless.listPublishedPosts as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0]?.[0]?.limit).toBe(50)
  })

  it('normalizes limit: NaN -> default 100', async () => {
    const posts = Array.from({ length: 101 }, () => makePost())
    const ampless = makeAmpless({
      cmsConfig: { ...BASE_CONFIG, ai: { llmsTxt: { limit: NaN } } },
      list: sequentialPages([{ items: posts, nextToken: null }]),
    })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(text).toContain(
      'Note: only the 100 most recent posts are listed; older posts are omitted.',
    )
  })

  it('normalizes limit: 1.5 -> floor 1', async () => {
    const posts = [makePost(), makePost()]
    const ampless = makeAmpless({
      cmsConfig: { ...BASE_CONFIG, ai: { llmsTxt: { limit: 1.5 } } },
      list: sequentialPages([{ items: posts, nextToken: null }]),
    })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(text).toContain(
      'Note: only the 1 most recent posts are listed; older posts are omitted.',
    )
    expect(text).toContain(`[${posts[0]!.title}]`)
    expect(text).not.toContain(`[${posts[1]!.title}]`)
  })

  it('normalizes limit: Infinity -> default 100', async () => {
    const posts = Array.from({ length: 101 }, () => makePost())
    const ampless = makeAmpless({
      cmsConfig: { ...BASE_CONFIG, ai: { llmsTxt: { limit: Infinity } } },
      list: sequentialPages([{ items: posts, nextToken: null }]),
    })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(text).toContain(
      'Note: only the 100 most recent posts are listed; older posts are omitted.',
    )
  })

  it('normalizes limit: -5 -> 1', async () => {
    const posts = [makePost(), makePost()]
    const ampless = makeAmpless({
      cmsConfig: { ...BASE_CONFIG, ai: { llmsTxt: { limit: -5 } } },
      list: sequentialPages([{ items: posts, nextToken: null }]),
    })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(text).toContain(
      'Note: only the 1 most recent posts are listed; older posts are omitted.',
    )
    expect(text).toContain(`[${posts[0]!.title}]`)
    expect(text).not.toContain(`[${posts[1]!.title}]`)
  })

  it('markdownRoutes: false -> links to the HTML URL and omits the .md intro line', async () => {
    const post = makePost({ slug: 'hello', title: 'Hello' })
    const ampless = makeAmpless({
      cmsConfig: { ...BASE_CONFIG, ai: { markdownRoutes: false } },
      list: sequentialPages([{ items: [post], nextToken: null }]),
    })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(text).toContain('[Hello](https://x.example.com/hello)')
    expect(text).not.toContain('.md')
  })

  it('site.url empty -> relative links', async () => {
    const post = makePost({ slug: 'hello', title: 'Hello' })
    const ampless = makeAmpless({
      settings: { url: '' },
      list: sequentialPages([{ items: [post], nextToken: null }]),
    })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(text).toContain('[Hello](/hello.md)')
  })

  it('site.url trailing slash is normalized (no double slash)', async () => {
    const post = makePost({ slug: 'hello', title: 'Hello' })
    const ampless = makeAmpless({
      settings: { url: 'https://x.example.com/' },
      list: sequentialPages([{ items: [post], nextToken: null }]),
    })
    const handler = createLlmsTxtRouteHandler(ampless)
    const text = await (await handler(makeRequest(), makeCtx())).text()
    expect(text).toContain('[Hello](https://x.example.com/hello.md)')
    expect(text).not.toContain('.com//hello')
  })

  describe('query-string redirect (CDN cache-key bypass defense)', () => {
    it('redirects to the bare path with 308 when any query string is present, without touching the database', async () => {
      const ampless = makeAmpless({ list: sequentialPages([{ items: [], nextToken: null }]) })
      const handler = createLlmsTxtRouteHandler(ampless)
      const res = await handler(makeRequest('https://x.example.com/llms.txt?x=random'), makeCtx())
      expect(res.status).toBe(308)
      expect(res.headers.get('Location')).toBe('/llms.txt')
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600')
      expect(ampless.listPublishedPosts).not.toHaveBeenCalled()
      expect(ampless.loadSiteSettings).not.toHaveBeenCalled()
    })

    it('does not redirect when there is no query string', async () => {
      const ampless = makeAmpless({ list: sequentialPages([{ items: [], nextToken: null }]) })
      const handler = createLlmsTxtRouteHandler(ampless)
      const res = await handler(makeRequest('https://x.example.com/llms.txt'), makeCtx())
      expect(res.status).toBe(200)
    })

    it('404s (not 308) when ai.llmsTxt is false, even with a query string present', async () => {
      const ampless = makeAmpless({
        cmsConfig: { ...BASE_CONFIG, ai: { llmsTxt: false } },
        list: sequentialPages([{ items: [], nextToken: null }]),
      })
      const handler = createLlmsTxtRouteHandler(ampless)
      const res = await handler(makeRequest('https://x.example.com/llms.txt?x=1'), makeCtx())
      expect(res.status).toBe(404)
      expect(res.status).not.toBe(308)
      expect(ampless.listPublishedPosts).not.toHaveBeenCalled()
    })
  })

  describe('real-parser structural validation (marked.lexer)', () => {
    it('parses as: depth-1 heading, blockquote/paragraphs, then a single H2 + list with one link per item', async () => {
      const posts = [
        makePost({ slug: 'a-b', title: 'Post [A] (one)' }),
        makePost({ slug: "c'd", title: 'Post & two' }),
        makePost({ slug: 'tags-only', title: 'Post three', excerpt: undefined, tags: ['x'] }),
      ]
      const ampless = makeAmpless({
        cmsConfig: { ...BASE_CONFIG, ai: { publicMcp: true } },
        settings: { name: 'Site', description: 'Desc' },
        list: sequentialPages([{ items: posts, nextToken: null }]),
      })
      const handler = createLlmsTxtRouteHandler(ampless)
      const text = await (await handler(makeRequest(), makeCtx())).text()

      const tokens = marked.lexer(text, { gfm: true, breaks: false }).filter(
        (t) => t.type !== 'space',
      )

      expect(tokens[0]!.type).toBe('heading')
      expect((tokens[0] as Tokens.Heading).depth).toBe(1)

      const h2Index = tokens.findIndex(
        (t) => t.type === 'heading' && (t as Tokens.Heading).depth === 2,
      )
      expect(h2Index).toBeGreaterThan(0)
      expect(text.indexOf('read-only MCP endpoint')).toBeLessThan(text.indexOf('## Posts'))

      for (const t of tokens.slice(1, h2Index)) {
        expect(['blockquote', 'paragraph']).toContain(t.type)
      }

      const afterH2 = tokens.slice(h2Index + 1)
      expect(afterH2.length).toBe(1)
      expect(afterH2[0]!.type).toBe('list')

      const list = afterH2[0] as Tokens.List
      expect(list.items.length).toBe(posts.length)

      list.items.forEach((item, i) => {
        const links = collectLinks(item.tokens)
        expect(links.length).toBe(1)
        const link = links[0] as Tokens.Link
        const expectedHref =
          'https://x.example.com/' +
          encodeURIComponent(posts[i]!.slug).replace(
            /[!'()*]/g,
            (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
          ) +
          '.md'
        expect(link.href).toBe(expectedHref)
        const expectedText = posts[i]!.title.replace(/\[/g, '&#91;').replace(/\]/g, '&#93;')
        expect(link.text).toBe(expectedText)
      })
    })
  })
})
