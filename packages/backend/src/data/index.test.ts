import { describe, it, expect } from 'vitest'
import {
  amplessSchemaModels,
  amplessSchemaAuthorization,
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

// Marker symbol so the proxy can recognise its own callable nodes and
// avoid re-invoking them when they get passed back through as args
// (which would cause infinite recursion when modeling chains like
// `.authorization((allow) => [allow.x()])`).
const PROXY_MARKER = Symbol('proxy-fn')

function makeFakeBuilder() {
  const calls: Array<{ method: string; args: unknown[] }> = []
  // Each proxy is both callable (records the call) AND has every
  // property return another proxy — so chains like `a.handler.custom({
  // ... })` and `a.model({...}).identifier(...).authorization(...)` all
  // record cleanly. Property reads themselves aren't recorded; only
  // the eventual function calls are.
  //
  // When a real (non-proxy) function is passed as an argument — e.g.
  // `.authorization((allow) => [allow.groups(...)])` — invoke it with
  // a fresh proxy so the auth rule expressions inside also get
  // recorded. Proxy-wrapped functions get re-invoked through normal
  // call dispatch and skip this step.
  function makeProxy(path: string): unknown {
    const fn = (...args: unknown[]) => {
      calls.push({ method: path, args })
      for (const arg of args) {
        if (
          typeof arg === 'function' &&
          !(arg as unknown as Record<symbol, unknown>)[PROXY_MARKER]
        ) {
          try {
            ;(arg as (allow: unknown) => unknown)(makeProxy('allow'))
          } catch {
            // ignore: caller's lambda might throw on a proxy method,
            // we only care about the calls it managed to make
          }
        }
      }
      return makeProxy('result')
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(fn as any)[PROXY_MARKER] = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Proxy(fn as any, {
      get(target, prop) {
        if (prop === PROXY_MARKER) return target[PROXY_MARKER]
        if (prop === 'then') return undefined // not a thenable
        if (typeof prop === 'symbol') return undefined
        return makeProxy(String(prop))
      },
    })
  }
  return { a: makeProxy('a'), calls }
}

describe('amplessSchemaModels', () => {
  it('returns the expected top-level keys', () => {
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
        'McpToken',
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

  it('never calls allow.resource at the model level (resource auth lives at schema scope)', () => {
    const { a, calls } = makeFakeBuilder()
    amplessSchemaModels(a)
    const resourceCalls = calls.filter((c) => c.method === 'resource')
    expect(resourceCalls).toHaveLength(0)
  })
})

describe('amplessSchemaAuthorization', () => {
  it('returns an empty array when no Lambda function refs are supplied', () => {
    const allow = {
      resource: () => ({ to: () => 'unused' }),
    }
    expect(amplessSchemaAuthorization(allow, {})).toEqual([])
    expect(amplessSchemaAuthorization(allow)).toEqual([])
  })

  it('produces allow.resource(fn).to(["query", "mutate"]) when mcpHandlerFunction is supplied', () => {
    const fakeFn = { __fakeFn: true }
    const seen: { resourceArg: unknown; toArg: unknown }[] = []
    const allow = {
      resource(arg: unknown) {
        const entry = { resourceArg: arg, toArg: undefined as unknown }
        seen.push(entry)
        return {
          to(ops: unknown) {
            entry.toArg = ops
            return 'rule'
          },
        }
      },
    }
    const rules = amplessSchemaAuthorization(allow, { mcpHandlerFunction: fakeFn })
    expect(rules).toEqual(['rule'])
    expect(seen).toHaveLength(1)
    expect(seen[0]!.resourceArg).toBe(fakeFn)
    expect(seen[0]!.toArg).toEqual(['query', 'mutate'])
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
