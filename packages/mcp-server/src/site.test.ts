import { describe, it, expect } from 'vitest'
import {
  buildServerName,
  decorateToolListing,
  assertConfirmSite,
  wrapResult,
  type ResolvedSite,
} from './site.js'

const normalTool = {
  name: 'list_posts',
  description: 'List posts in the CMS.',
  inputSchema: { type: 'object', properties: { limit: { type: 'number' } }, required: [] as string[] },
}

const destructiveTool = {
  name: 'delete_post',
  description: 'Delete a post by postId.',
  inputSchema: {
    type: 'object',
    properties: { postId: { type: 'string' } },
    required: ['postId'] as string[],
  },
  destructive: true,
}

const devSite: ResolvedSite = { name: 'mysite.net', url: 'https://mysite.net', environment: 'dev', siteId: 'default' }
const prodSite: ResolvedSite = { name: 'mysite.net', url: 'https://mysite.net', environment: 'prod', siteId: 'default' }

describe('buildServerName', () => {
  it('returns default name when site is undefined', () => {
    expect(buildServerName(undefined)).toBe('@ampless/mcp-server')
  })

  it('includes site name and environment in server name', () => {
    expect(buildServerName(devSite)).toBe('@ampless/mcp-server [mysite.net/dev]')
    expect(buildServerName(prodSite)).toBe('@ampless/mcp-server [mysite.net/prod]')
  })
})

describe('decorateToolListing — no site', () => {
  it('returns tools unchanged when site is undefined', () => {
    const tools = [normalTool, destructiveTool]
    const result = decorateToolListing(tools, undefined)
    expect(result).toHaveLength(2)
    expect(result[0]!.description).toBe(normalTool.description)
    expect(result[1]!.description).toBe(destructiveTool.description)
    expect(result[1]!.inputSchema).toEqual(destructiveTool.inputSchema)
  })
})

describe('decorateToolListing — site + env=dev', () => {
  it('prefixes description with site and environment', () => {
    const result = decorateToolListing([normalTool], devSite)
    expect(result[0]!.description).toBe('[mysite.net / dev] List posts in the CMS.')
  })

  it('marks destructive tools but does not inject confirmSite', () => {
    const result = decorateToolListing([destructiveTool], devSite)
    expect(result[0]!.description).toBe('[mysite.net / dev — destructive] Delete a post by postId.')
    const props = (result[0]!.inputSchema as Record<string, unknown>).properties as Record<string, unknown>
    expect(props['confirmSite']).toBeUndefined()
    const required = (result[0]!.inputSchema as Record<string, unknown>).required as string[]
    expect(required).not.toContain('confirmSite')
  })
})

describe('decorateToolListing — site + env=prod', () => {
  it('uses PROD label and appends Requires sentence for destructive tools', () => {
    const result = decorateToolListing([destructiveTool], prodSite)
    expect(result[0]!.description).toContain('[mysite.net / PROD — destructive]')
    expect(result[0]!.description).toContain('Requires confirmSite: "mysite.net".')
  })

  it('injects confirmSite into inputSchema.properties and required for destructive tools', () => {
    const result = decorateToolListing([destructiveTool], prodSite)
    const schema = result[0]!.inputSchema as Record<string, unknown>
    const props = schema.properties as Record<string, unknown>
    expect(props['confirmSite']).toBeDefined()
    const req = schema.required as string[]
    expect(req).toContain('confirmSite')
    expect(req).toContain('postId')
  })

  it('does not mutate the original inputSchema', () => {
    decorateToolListing([destructiveTool], prodSite)
    const props = destructiveTool.inputSchema.properties as Record<string, unknown>
    expect(props['confirmSite']).toBeUndefined()
    expect(destructiveTool.inputSchema.required).not.toContain('confirmSite')
  })

  it('does not inject confirmSite for non-destructive tools', () => {
    const result = decorateToolListing([normalTool], prodSite)
    expect(result[0]!.description).not.toContain('destructive')
    const props = (result[0]!.inputSchema as Record<string, unknown>).properties as Record<string, unknown>
    expect(props['confirmSite']).toBeUndefined()
  })
})

describe('assertConfirmSite', () => {
  it('does nothing when site is undefined', () => {
    expect(() => assertConfirmSite(destructiveTool, {}, undefined)).not.toThrow()
  })

  it('does nothing when env is not prod', () => {
    expect(() => assertConfirmSite(destructiveTool, {}, devSite)).not.toThrow()
  })

  it('does nothing for non-destructive tool even in prod', () => {
    expect(() => assertConfirmSite(normalTool, {}, prodSite)).not.toThrow()
  })

  it('throws when confirmSite is missing in prod destructive call', () => {
    expect(() => assertConfirmSite(destructiveTool, { postId: 'p1' }, prodSite)).toThrow()
  })

  it('throws when confirmSite does not match site name', () => {
    expect(() =>
      assertConfirmSite(destructiveTool, { postId: 'p1', confirmSite: 'wrong-site' }, prodSite)
    ).toThrow(/confirmSite mismatch/)
  })

  it('passes when confirmSite matches site name', () => {
    expect(() =>
      assertConfirmSite(destructiveTool, { postId: 'p1', confirmSite: 'mysite.net' }, prodSite)
    ).not.toThrow()
  })
})

describe('wrapResult', () => {
  it('returns result unchanged when site is undefined', () => {
    const r = { posts: [] }
    expect(wrapResult(r, undefined)).toBe(r)
  })

  it('wraps result in envelope when site is set', () => {
    const r = { posts: [] }
    const wrapped = wrapResult(r, devSite) as { site: ResolvedSite; result: unknown }
    expect(wrapped.site).toEqual(devSite)
    expect(wrapped.result).toBe(r)
  })
})
