import { describe, expect, it } from 'vitest'

import { resolvePublicMcpEndpoint } from './public-mcp.js'

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

  it('drops userinfo credentials embedded in site.url', () => {
    const endpoint = resolvePublicMcpEndpoint(true, 'https://user:secret@example.com')
    expect(endpoint).toBe('https://example.com/api/mcp')
    const serialized = JSON.stringify({ endpoint })
    expect(serialized).not.toContain('user')
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('@')
  })
})
