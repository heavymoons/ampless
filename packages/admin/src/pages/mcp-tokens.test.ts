import { describe, expect, it, vi } from 'vitest'
import type { Admin } from '../index.js'

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

import { createMcpTokensPage } from './mcp-tokens.js'

// `resolvePublicMcpEndpoint` itself now lives in `ampless` core (shared
// with the `/llms.txt` route) and is unit-tested there
// (`packages/ampless/src/public-mcp.test.ts`). The tests below only cover
// this page's wiring: whether it calls the resolver at all, and threads
// the result through as `publicMcpEndpoint`.

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
