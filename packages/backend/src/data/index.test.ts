import { describe, it, expect } from 'vitest'
import {
  amplessSchemaModels,
  defaultAuthorizationModes,
  DEFAULT_RESOLVER_PATHS,
} from './index.js'

// `amplessSchemaModels` builds against `@aws-amplify/backend`'s `a`
// builder, which we don't pull into this test because it's tightly
// coupled to CDK. Instead we hand it a minimal proxy that records every
// call so we can assert on the model surface.
//
// Each method returns a chainable proxy node so the function can call
// `.model(...).identifier(...).secondaryIndexes(...).authorization(...)`
// without blowing up.

function makeFakeBuilder() {
  const calls: Array<{ method: string; args: unknown[] }> = []
  // Each proxy is both callable (records the call) AND has every
  // property return another proxy — so chains like `a.handler.custom({
  // ... })` and `a.model({...}).identifier(...).authorization(...)` all
  // record cleanly. Property reads themselves aren't recorded; only
  // the eventual function calls are.
  function makeProxy(path: string): unknown {
    const fn = (...args: unknown[]) => {
      calls.push({ method: path, args })
      return makeProxy('result')
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Proxy(fn as any, {
      get(_t, prop) {
        if (prop === 'then') return undefined // not a thenable
        if (typeof prop === 'symbol') return undefined
        return makeProxy(String(prop))
      },
    })
  }
  return { a: makeProxy('a'), calls }
}

describe('amplessSchemaModels', () => {
  it('returns the seven expected top-level keys', () => {
    const { a } = makeFakeBuilder()
    const models = amplessSchemaModels(a)
    const keys = Object.keys(models).sort()
    expect(keys).toEqual(
      [
        'Post',
        'Page',
        'Media',
        'Taxonomy',
        'PostTag',
        'KvStore',
        'PublicPost',
        'PublicPostConnection',
        'listPublishedPosts',
        'getPublishedPost',
        'listPostsByTag',
      ].sort()
    )
  })

  it('uses the default resolver paths for the three public queries', () => {
    const { a, calls } = makeFakeBuilder()
    amplessSchemaModels(a)
    // `a.handler.custom({ entry: '...' })` shows up as a method call on
    // the proxy with a single object argument carrying `entry`.
    const customCalls = calls.filter((c) => c.method === 'custom')
    const entries = customCalls
      .map((c) => (c.args[0] as { entry?: string }).entry)
      .filter((e): e is string => typeof e === 'string')
    expect(entries).toContain(DEFAULT_RESOLVER_PATHS.listPublishedPosts)
    expect(entries).toContain(DEFAULT_RESOLVER_PATHS.getPublishedPost)
    expect(entries).toContain(DEFAULT_RESOLVER_PATHS.listPostsByTag)
  })

  it('honors per-resolver path overrides', () => {
    const { a, calls } = makeFakeBuilder()
    amplessSchemaModels(a, {
      resolverPaths: {
        listPublishedPosts: './resolvers/lp.js',
      },
    })
    const customCalls = calls.filter((c) => c.method === 'custom')
    const entries = customCalls
      .map((c) => (c.args[0] as { entry?: string }).entry)
      .filter((e): e is string => typeof e === 'string')
    expect(entries).toContain('./resolvers/lp.js')
    // unspecified resolvers fall back to defaults
    expect(entries).toContain(DEFAULT_RESOLVER_PATHS.getPublishedPost)
  })
})

describe('defaultAuthorizationModes', () => {
  it('defaults to userPool with a 365-day API key', () => {
    expect(defaultAuthorizationModes).toEqual({
      defaultAuthorizationMode: 'userPool',
      apiKeyAuthorizationMode: { expiresInDays: 365 },
    })
  })
})
