// End-to-end check of the admin provider's conditional update against the
// REAL AppSync resolver (templates/_shared/amplify/data/
// update-post-if-unchanged.js), executed by the in-memory Post table in
// packages/backend/src/data/post-table-fake.js. Both are loaded by relative
// path (test-only; the fake is plain JS so it stays outside this package's
// tsconfig). The fake GraphQL client returns rows the way AppSync does
// (AWSJSON fields as JSON strings, absent attributes as null), so the
// values the provider reads through `toCorePost` are exactly what it later
// sends back as `expected`.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Post } from 'ampless'

const clock = vi.hoisted(() => ({ nowMs: 0 }))
const state = vi.hoisted(() => ({ table: null as unknown }))

vi.mock('@aws-appsync/utils', async () => {
  // @ts-expect-error -- untyped JS test support
  const fake = await import('../../../backend/src/data/post-table-fake.js')
  return fake.appsyncUtilsMock(clock)
})

interface FakeTable {
  item: Record<string, unknown> | null
  writes: number
  runResolver: (resolver: unknown, args: Record<string, unknown>) => Record<string, unknown>
  stockUpdate: (fields: Record<string, unknown>) => Record<string, unknown>
  stockDelete: () => void
}
const table = () => state.table as FakeTable

vi.mock('aws-amplify/api', async () => {
  // @ts-expect-error -- untyped JS test support
  const fake = await import('../../../backend/src/data/post-table-fake.js')
  const resolver = await import(
    // @ts-expect-error -- untyped AppSync JS resolver
    '../../../../templates/_shared/amplify/data/update-post-if-unchanged.js'
  )
  return {
    generateClient: () => ({
      models: {
        Post: {
          async get() {
            return { data: fake.wireRow((state.table as FakeTable).item), errors: null }
          },
          async update() {
            throw new Error('unconditional update must not be used')
          },
        },
        PostHistory: {},
      },
      // Amplify's client.graphql rejects with `{ data, errors }` on errors.
      async graphql({ variables }: { variables: Record<string, unknown> }) {
        try {
          const item = (state.table as FakeTable).runResolver(resolver, variables)
          return { data: { amplessUpdatePostIfUnchanged: fake.wireRow(item) } }
        } catch (e) {
          const err = e as { message: string; type?: string }
          throw { data: null, errors: [{ errorType: err.type, message: err.message }] }
        }
      },
    }),
  }
})

const T = '2026-06-01T00:00:00.000Z'
const KEY = 'ampless:postClasses'
const tagged = (ids: string[]) => ({ kind: 'ampless.post-classes', version: 1, ids })

async function setup(item: Record<string, unknown>) {
  vi.resetModules()
  // @ts-expect-error -- untyped JS test support
  const fake = await import('../../../backend/src/data/post-table-fake.js')
  state.table = fake.createFakePostTable(item, clock)
  const { installAdminPostsProvider } = await import('./posts-provider.js')
  const core = await import('ampless')
  installAdminPostsProvider()
  return core
}

beforeEach(() => {
  clock.nowMs = Date.parse(T) // frozen: every write lands in the same ms
})

describe('admin conditional save through the real resolver', () => {
  it('(a) a same-millisecond external metadata write makes the stale editor save conflict; the external metadata survives', async () => {
    const core = await setup({
      postId: 'p1', slug: 'weekly', title: 'Weekly', format: 'markdown', body: 'hello', status: 'draft',
      metadata: { cache: 'deep' }, createdAt: T, updatedAt: T,
    })
    const loaded = (await core.getPostById('p1')) as Post
    // External stock write in the same millisecond: updatedAt stays T.
    table().stockUpdate({ metadata: { cache: 'deep', [KEY]: tagged(['wide']) } })
    expect(table().item!.updatedAt).toBe(T)

    const err = await core
      .updatePost('p1', { title: 'Edited', metadata: { ...loaded.metadata } }, { expected: loaded })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(core.PostUpdateConflictError)
    expect(table().item!.metadata).toEqual({ cache: 'deep', [KEY]: tagged(['wide']) })
    expect(table().item!.title).toBe('Weekly')
  })

  it('a row with collapsed fields (no format / status / tags / excerpt, tiptap body map) round-trips and saves', async () => {
    const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }
    const core = await setup({ postId: 'p1', slug: 's', title: 't', body, createdAt: T, updatedAt: T })
    const loaded = (await core.getPostById('p1')) as Post
    expect(loaded).toMatchObject({ format: 'markdown', status: 'draft', tags: [] })

    const saved = await core.updatePost(
      'p1',
      { title: 'T2', slug: 's', excerpt: '', format: loaded.format, body: loaded.body, status: 'draft', tags: [], metadata: {} },
      { expected: loaded }
    )
    expect(saved.title).toBe('T2')
    expect(saved.updatedAt).toBe('2026-06-01T00:00:00.001Z') // strictly newer with a frozen clock
    expect(table().item!.excerpt).toBe('')
    expect(table().item!.body).toEqual(body)
  })

  it('(d) a concurrent delete conflicts and does not resurrect the post', async () => {
    const core = await setup({ postId: 'p1', slug: 's', title: 't', format: 'html', body: '<p/>', status: 'draft', createdAt: T, updatedAt: T })
    const loaded = (await core.getPostById('p1')) as Post
    table().stockDelete()
    await expect(core.updatePost('p1', { title: 'x' }, { expected: loaded })).rejects.toBeInstanceOf(
      core.PostUpdateConflictError
    )
    expect(table().item).toBeNull()
  })
})
