import { describe, it, expect, vi } from 'vitest'
import { setPostClasses } from './set-post-classes.js'
import { isConditionalCheckFailed, isConditionalMutationMissing } from './graphql-errors.js'
import { toCorePost } from './post-mapping.js'
import { postVersion } from './post-version.js'
import type { GraphqlClient } from './types.js'

const KEY = 'ampless:postClasses'
const T0 = '2026-06-01T00:00:00.000Z'
const T1 = '2026-06-01T00:00:05.000Z'
const tagged = (ids: string[]) => ({ kind: 'ampless.post-classes', version: 1, ids })

const OTHER_KEYS = {
  cache: 'deep',
  seo: { title: 'SEO' },
  postClasses: ['legacy'],
  files: { 'a.css': { size: 1, mimeType: 'text/css' } },
}

function row(over: Record<string, unknown> = {}) {
  return {
    postId: 'p1',
    slug: 'weekly',
    title: 'Weekly',
    format: 'markdown',
    body: '"hello"',
    status: 'published',
    publishedAt: T0,
    updatedAt: T0,
    tags: [],
    metadata: JSON.stringify({ ...OTHER_KEYS, [KEY]: tagged(['wide']) }),
    ...over,
  }
}

/** The version get_post returns for `row(over)`. */
const versionOf = (over: Record<string, unknown> = {}) => postVersion(toCorePost(row(over)))
const V0 = versionOf()

interface Call {
  op: string
  vars: Record<string, unknown> | undefined
}

function makeGraphql(
  current: Record<string, unknown> | null,
  opts: { mutate?: (vars: Record<string, unknown>) => unknown } = {},
) {
  const calls: Call[] = []
  const graphql: GraphqlClient = {
    async query<T>(op: string, vars?: Record<string, unknown>): Promise<T> {
      calls.push({ op, vars })
      if (op.includes('getPost(')) return { getPost: current } as T
      if (op.includes('amplessUpdatePostIfUnchanged(')) {
        if (opts.mutate) return opts.mutate(vars!) as T
        const patch = JSON.parse(vars!.patch as string) as { metadata: unknown }
        return { amplessUpdatePostIfUnchanged: { ...current, metadata: JSON.stringify(patch.metadata), updatedAt: T1 } } as T
      }
      throw new Error(`unexpected op ${op}`)
    },
  }
  const mutations = () => calls.filter((c) => c.op.includes('amplessUpdatePostIfUnchanged('))
  return { graphql, calls, mutations }
}

const conditionFailed = () =>
  Object.assign(new Error('AppSync GraphQL error: The conditional request failed'), {
    errors: [{ errorType: 'DynamoDB:ConditionalCheckFailedException', message: 'The conditional request failed' }],
  })
const fieldUndefined = () =>
  Object.assign(new Error("AppSync GraphQL error: Validation error of type FieldUndefined: Field 'amplessUpdatePostIfUnchanged' in type 'Mutation' is undefined"), {
    errors: [
      {
        errorType: 'FieldUndefined',
        message: "Validation error of type FieldUndefined: Field 'amplessUpdatePostIfUnchanged' in type 'Mutation' is undefined @ 'amplessUpdatePostIfUnchanged'",
      },
    ],
  })

describe('set_post_classes — ids (full replacement, requires expectedVersion)', () => {
  it('merges into the freshly read metadata and writes only metadata, conditioned on every field of the read', async () => {
    const { graphql, mutations } = makeGraphql(row())
    const out = await setPostClasses(graphql, { postId: 'p1', ids: ['serif', 'wide', 'serif'], expectedVersion: V0 })

    expect(mutations()).toHaveLength(1)
    const { op, vars } = mutations()[0]!
    expect(op).toContain('amplessUpdatePostIfUnchanged(postId: $postId, patch: $patch, expected: $expected)')
    expect(op).not.toContain('updatePost(')
    expect(vars!.postId).toBe('p1')
    expect(JSON.parse(vars!.patch as string)).toEqual({ metadata: { ...OTHER_KEYS, [KEY]: tagged(['serif', 'wide']) } })
    expect(JSON.parse(vars!.expected as string)).toEqual({
      updatedAt: T0,
      title: 'Weekly',
      slug: 'weekly',
      excerpt: null,
      format: 'markdown',
      body: 'hello',
      status: 'published',
      publishedAt: T0,
      tags: [],
      metadata: { ...OTHER_KEYS, [KEY]: tagged(['wide']) },
    })
    expect(out).toEqual({ post: expect.objectContaining({ metadata: { ...OTHER_KEYS, [KEY]: tagged(['serif', 'wide']) } }) })
    expect(out.post.version).toMatch(/^v1:[0-9a-f]{64}$/)
    expect(out.post.version).not.toBe(V0)
  })

  it('an empty list removes the key and keeps every other one', async () => {
    const { graphql, mutations } = makeGraphql(row())
    await setPostClasses(graphql, { postId: 'p1', ids: [], expectedVersion: V0 })
    expect(JSON.parse(mutations()[0]!.vars!.patch as string)).toEqual({ metadata: OTHER_KEYS })
  })

  it('is refused without expectedVersion, before any read', async () => {
    const { graphql, calls } = makeGraphql(row())
    await expect(setPostClasses(graphql, { postId: 'p1', ids: ['wide'] })).rejects.toThrow(
      /`ids` replaces the whole list.*requires `expectedVersion`.*add.*remove.*Nothing was saved/s,
    )
    expect(calls).toHaveLength(0)
  })

  it('conflicts before writing when the version differs — also when only content changed and updatedAt is the same', async () => {
    for (const over of [{ updatedAt: T1 }, { metadata: JSON.stringify({ ...OTHER_KEYS, plugin: 1, [KEY]: tagged(['wide']) }) }]) {
      const { graphql, mutations } = makeGraphql(row(over))
      await expect(setPostClasses(graphql, { postId: 'p1', ids: ['serif'], expectedVersion: V0 })).rejects.toThrow(
        /conflict.*Nothing was saved/s,
      )
      expect(mutations()).toHaveLength(0)
    }
  })

  it('a conflicting write fails at once (no retry)', async () => {
    const { graphql, mutations } = makeGraphql(row(), {
      mutate: () => {
        throw conditionFailed()
      },
    })
    await expect(setPostClasses(graphql, { postId: 'p1', ids: ['wide'], expectedVersion: V0 })).rejects.toThrow(/conflict/)
    expect(mutations()).toHaveLength(1)
  })

  it('a deleted post is a conflict', async () => {
    const { graphql } = makeGraphql(null)
    await expect(setPostClasses(graphql, { postId: 'p1', ids: ['wide'], expectedVersion: V0 })).rejects.toThrow(/conflict/)
  })
})

describe('set_post_classes — add / remove', () => {
  it('applies the set operations to the fresh read and conditions on its metadata / format / updatedAt', async () => {
    const { graphql, mutations } = makeGraphql(row())
    await setPostClasses(graphql, { postId: 'p1', add: ['serif', 'wide'] })
    const { vars } = mutations()[0]!
    expect(JSON.parse(vars!.patch as string)).toEqual({ metadata: { ...OTHER_KEYS, [KEY]: tagged(['wide', 'serif']) } })
    expect(JSON.parse(vars!.expected as string)).toEqual({
      updatedAt: T0,
      format: 'markdown',
      metadata: { ...OTHER_KEYS, [KEY]: tagged(['wide']) },
    })
  })

  it('removing the last id removes the key; absent ids are ignored', async () => {
    const { graphql, mutations } = makeGraphql(row())
    await setPostClasses(graphql, { postId: 'p1', remove: ['wide', 'never-there'] })
    expect(JSON.parse(mutations()[0]!.vars!.patch as string)).toEqual({ metadata: OTHER_KEYS })
  })

  it('works on a post without metadata (expected metadata null)', async () => {
    const { graphql, mutations } = makeGraphql(row({ metadata: null }))
    await setPostClasses(graphql, { postId: 'p1', add: ['wide'] })
    expect(JSON.parse(mutations()[0]!.vars!.patch as string)).toEqual({ metadata: { [KEY]: tagged(['wide']) } })
    expect(JSON.parse(mutations()[0]!.vars!.expected as string)).toMatchObject({ metadata: null })
  })

  it('on a conflict re-reads and retries, up to 3 attempts in total, then reports the conflict', async () => {
    const { graphql, mutations, calls } = makeGraphql(row(), {
      mutate: () => {
        throw conditionFailed()
      },
    })
    await expect(setPostClasses(graphql, { postId: 'p1', add: ['serif'] })).rejects.toThrow(
      /conflict.*Nothing was saved.*get_post.*retry/s,
    )
    expect(mutations()).toHaveLength(3)
    expect(calls.filter((c) => c.op.includes('getPost('))).toHaveLength(3)
  })

  it('a retry after a conflict succeeds with the re-read state', async () => {
    let n = 0
    const { graphql, mutations } = makeGraphql(row(), {
      mutate: (vars) => {
        n += 1
        if (n === 1) throw conditionFailed()
        return { amplessUpdatePostIfUnchanged: { ...row(), metadata: JSON.stringify(JSON.parse(vars.patch as string).metadata), updatedAt: T1 } }
      },
    })
    const out = await setPostClasses(graphql, { postId: 'p1', add: ['serif'] })
    expect(mutations()).toHaveLength(2)
    expect(out.post.updatedAt).toBe(T1)
  })

  it('with expectedVersion: version check, every field conditioned, no retry', async () => {
    const stale = makeGraphql(row({ title: 'Changed' }))
    await expect(setPostClasses(stale.graphql, { postId: 'p1', add: ['serif'], expectedVersion: V0 })).rejects.toThrow(/conflict/)
    expect(stale.mutations()).toHaveLength(0)

    const racing = makeGraphql(row(), {
      mutate: () => {
        throw conditionFailed()
      },
    })
    await expect(setPostClasses(racing.graphql, { postId: 'p1', remove: ['wide'], expectedVersion: V0 })).rejects.toThrow(/conflict/)
    expect(racing.mutations()).toHaveLength(1)
    expect(Object.keys(JSON.parse(racing.mutations()[0]!.vars!.expected as string)).sort()).toEqual(
      ['body', 'excerpt', 'format', 'metadata', 'publishedAt', 'slug', 'status', 'tags', 'title', 'updatedAt'],
    )
  })

  it('rejects mixing ids with add/remove, overlaps, nothing to do, and invalid ids — before any read', async () => {
    const { graphql, calls } = makeGraphql(row())
    await expect(setPostClasses(graphql, { postId: 'p1', ids: ['a'], add: ['b'], expectedVersion: V0 })).rejects.toThrow(/either `ids`/)
    await expect(setPostClasses(graphql, { postId: 'p1', add: ['a'], remove: ['a'] })).rejects.toThrow(/both `add` and `remove`/)
    await expect(setPostClasses(graphql, { postId: 'p1' })).rejects.toThrow(/at least one of `add` \/ `remove`/)
    await expect(setPostClasses(graphql, { postId: 'p1', add: [], remove: [] })).rejects.toThrow(/nothing to change/)
    await expect(setPostClasses(graphql, { postId: 'p1', add: ['Wide'] })).rejects.toThrow(/invalid post class id/)
    await expect(setPostClasses(graphql, { postId: 'p1', add: ['a'], expectedVersion: '' })).rejects.toThrow(/expectedVersion/)
    expect(calls).toHaveLength(0)
  })
})

describe('set_post_classes — refusals and failures', () => {
  it('a backend without the mutation fails clearly, never falls back to the stock update', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { graphql, calls } = makeGraphql(row(), {
      mutate: () => {
        throw fieldUndefined()
      },
    })
    await expect(setPostClasses(graphql, { postId: 'p1', add: ['wide'] })).rejects.toThrow(
      /lacks the amplessUpdatePostIfUnchanged mutation.*create-ampless upgrade.*Nothing was saved/s,
    )
    expect(calls.some((c) => c.op.includes('updatePost('))).toBe(false)
    errorSpy.mockRestore()
  })

  it('rethrows non-conflict write errors', async () => {
    const boom = new Error('AppSync GraphQL error: Not Authorized')
    const { graphql } = makeGraphql(row(), {
      mutate: () => {
        throw boom
      },
    })
    await expect(setPostClasses(graphql, { postId: 'p1', add: ['wide'] })).rejects.toBe(boom)
  })

  it('refuses static and no_layout HTML posts without writing', async () => {
    for (const over of [
      { format: 'static', body: JSON.stringify({ entrypoint: 'index.html', files: ['index.html'] }) },
      { format: 'html', metadata: JSON.stringify({ no_layout: true }) },
    ]) {
      const { graphql, mutations } = makeGraphql(row(over))
      await expect(setPostClasses(graphql, { postId: 'p1', add: ['wide'] })).rejects.toThrow(/never applied.*nothing was saved/)
      await expect(setPostClasses(graphql, { postId: 'p1', ids: ['wide'], expectedVersion: versionOf(over) })).rejects.toThrow(
        /never applied.*nothing was saved/,
      )
      expect(mutations()).toHaveLength(0)
    }
  })

  it('refuses when the key holds a foreign value, leaving it untouched', async () => {
    const { graphql, mutations } = makeGraphql(row({ metadata: JSON.stringify({ [KEY]: ['wide'] }) }))
    await expect(setPostClasses(graphql, { postId: 'p1', add: ['wide'] })).rejects.toThrow(/not a tagged/)
    expect(mutations()).toHaveLength(0)
  })

  it('refuses a post without updatedAt and a missing post', async () => {
    const noVersion = makeGraphql(row({ updatedAt: null }))
    await expect(setPostClasses(noVersion.graphql, { postId: 'p1', add: ['wide'] })).rejects.toThrow(/no updatedAt/)
    await expect(
      setPostClasses(noVersion.graphql, { postId: 'p1', ids: ['wide'], expectedVersion: versionOf({ updatedAt: null }) }),
    ).rejects.toThrow(/no updatedAt/)
    expect(noVersion.mutations()).toHaveLength(0)

    const missing = makeGraphql(null)
    await expect(setPostClasses(missing.graphql, { postId: 'p1', add: ['wide'] })).rejects.toThrow(/not found/)
  })
})

describe('isConditionalCheckFailed', () => {
  it('detects the errorType, the message fallback, and nothing else', () => {
    expect(isConditionalCheckFailed(conditionFailed())).toBe(true)
    expect(isConditionalCheckFailed({ errors: [{ message: 'DynamoDB:ConditionalCheckFailedException: x' }] })).toBe(true)
    expect(isConditionalCheckFailed(new Error('AppSync GraphQL error: ConditionalCheckFailedException'))).toBe(true)
    expect(isConditionalCheckFailed(new Error('AppSync GraphQL error: Not Authorized'))).toBe(false)
    expect(isConditionalCheckFailed({ errors: [{ errorType: 'Unauthorized' }] })).toBe(false)
    expect(isConditionalCheckFailed(null)).toBe(false)
  })
})

describe('isConditionalMutationMissing', () => {
  it('detects an undefined-field error naming the mutation, and nothing else', () => {
    expect(isConditionalMutationMissing(fieldUndefined())).toBe(true)
    expect(isConditionalMutationMissing(new Error("AppSync GraphQL error: Field 'amplessUpdatePostIfUnchanged' in type 'Mutation' is undefined"))).toBe(true)
    expect(isConditionalMutationMissing({ errors: [{ errorType: 'FieldUndefined', message: "Field 'other' in type 'Post' is undefined" }] })).toBe(false)
    expect(isConditionalMutationMissing({ errors: [{ errorType: 'AmplessValidationError', message: 'amplessUpdatePostIfUnchanged: patch.format must be one of ...' }] })).toBe(false)
    expect(isConditionalMutationMissing(conditionFailed())).toBe(false)
    expect(isConditionalMutationMissing(null)).toBe(false)
  })
})
