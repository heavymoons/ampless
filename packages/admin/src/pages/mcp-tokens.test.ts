import { describe, expect, it, vi } from 'vitest'
import type { Admin } from '../index.js'

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

import { createMcpTokensPage, resolvePublicMcpEndpoint } from './mcp-tokens.js'

describe('resolvePublicMcpEndpoint', () => {
  it.each([undefined, false])('returns undefined when public MCP is %s', (publicMcp) => {
    expect(resolvePublicMcpEndpoint(publicMcp, 'https://example.com')).toBeUndefined()
  })

  it.each([
    undefined,
    '',
    '   ',
    'not a URL',
    'ftp://example.com',
    'mailto:hello@example.com',
  ])('returns null for an unusable site URL: %s', (siteUrl) => {
    expect(resolvePublicMcpEndpoint(true, siteUrl)).toBeNull()
  })

  it('normalizes the endpoint to the site root for HTTP(S) URLs', () => {
    expect(resolvePublicMcpEndpoint(true, 'https://example.com/blog/')).toBe(
      'https://example.com/api/mcp',
    )
    expect(resolvePublicMcpEndpoint(true, 'http://localhost:3000/base')).toBe(
      'http://localhost:3000/api/mcp',
    )
  })
})

function makeAdmin(publicMcp: boolean | undefined, loadSiteSettings = vi.fn()) {
  return {
    getServerSession: vi.fn(async () => ({ userId: 'user-1', email: 'admin@example.com' })),
    isAdmin: vi.fn(() => true),
    outputs: {},
    cmsConfig: { site: { name: 'Site', url: 'https://config.example.com' }, ai: { publicMcp } },
    loadSiteSettings,
  } as unknown as Admin
}

describe('createMcpTokensPage public endpoint loading', () => {
  it('does not load site settings when public MCP is disabled', async () => {
    const loadSiteSettings = vi.fn()
    const Page = createMcpTokensPage(makeAdmin(false, loadSiteSettings))
    const element = await Page()
    expect(loadSiteSettings).not.toHaveBeenCalled()
    expect(element.props.publicMcpEndpoint).toBeUndefined()
  })

  it('loads the effective site URL when public MCP is enabled', async () => {
    const loadSiteSettings = vi.fn(async () => ({
      site: { name: 'Site', url: 'https://effective.example.com/base' },
      media: {},
    }))
    const Page = createMcpTokensPage(makeAdmin(true, loadSiteSettings))
    const element = await Page()
    expect(loadSiteSettings).toHaveBeenCalledOnce()
    expect(element.props.publicMcpEndpoint).toBe('https://effective.example.com/api/mcp')
  })

  it('shows the missing state when effective settings cannot be loaded', async () => {
    const loadSiteSettings = vi.fn(async () => {
      throw new Error('settings unavailable')
    })
    const Page = createMcpTokensPage(makeAdmin(true, loadSiteSettings))
    const element = await Page()
    expect(element.props.publicMcpEndpoint).toBeNull()
  })
})
