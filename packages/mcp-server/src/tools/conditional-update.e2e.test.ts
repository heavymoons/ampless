// End-to-end: MCP get_post / set_post_classes / update_post(expectedVersion)
// against the REAL AppSync resolver (templates/_shared/amplify/data/
// update-post-if-unchanged.js) executed by the in-memory Post table in
// packages/backend/src/data/post-table-fake.js (both loaded by relative path,
// test-only). The fake GraphQL client serves getPost from the table in
// AppSync's wire shape and throws errors the way the MCP Lambda client does
// (Error with the GraphQL `errors` attached). The clock is frozen, so every
// write — the stock writer's included — lands in the same millisecond and a
// stock write leaves updatedAt unchanged.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GraphqlClient } from './types.js'

const clock = vi.hoisted(() => ({ nowMs: 0 }))

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

// @ts-expect-error -- untyped JS test support
const fake = await import('../../../backend/src/data/post-table-fake.js')
const resolver = await import(
  // @ts-expect-error -- untyped AppSync JS resolver
  '../../../../templates/_shared/amplify/data/update-post-if-unchanged.js'
)
const { setPostClasses } = await import('./set-post-classes.js')
const { updatePost } = await import('./update-post.js')
const { getPost } = await import('./get-post.js')

const T = '2026-06-01T00:00:00.000Z'
const KEY = 'ampless:postClasses'
const tagged = (ids: string[]) => ({ kind: 'ampless.post-classes', version: 1, ids })

let table: FakeTable

/** Client over the fake table; `beforeWrite` runs before each conditional write (an interleaving hook). */
function client(beforeWrite: (n: number) => void = () => {}): GraphqlClient & { writes: () => number } {
  let n = 0
  return {
    writes: () => n,
    async query<T>(op: string, vars?: Record<string, unknown>): Promise<T> {
      await Promise.resolve() // yield, so concurrent tool calls interleave
      if (op.includes('getPost(')) return { getPost: fake.wireRow(table.item) } as T
      if (op.includes('amplessUpdatePostIfUnchanged(')) {
        n += 1
        beforeWrite(n)
        try {
          return { amplessUpdatePostIfUnchanged: fake.wireRow(table.runResolver(resolver, vars!)) } as T
        } catch (e) {
          const err = e as { message: string; type?: string }
          throw Object.assign(new Error(`AppSync GraphQL error: ${err.message}`), {
            errors: [{ errorType: err.type, message: err.message }],
          })
        }
      }
      throw new Error(`unexpected op ${op}`)
    },
  }
}

/** A stock (unconditional) write that adds `extra` to whatever metadata is stored now. */
function stockAddMetadata(extra: Record<string, unknown>) {
  table.stockUpdate({ metadata: { ...(table.item!.metadata as Record<string, unknown>), ...extra } })
}

/** What an agent sees from get_post right now. */
async function agentRead() {
  const post = await getPost(client(), { postId: 'p1' })
  return post!
}

beforeEach(() => {
  clock.nowMs = Date.parse(T)
  table = fake.createFakePostTable(
    {
      postId: 'p1', slug: 'weekly', title: 'Weekly', format: 'markdown', body: 'hello', status: 'draft',
      tags: [], metadata: { cache: 'deep' }, createdAt: T, updatedAt: T,
    },
    clock,
  ) as FakeTable
})

describe('get_post version', () => {
  it('is stable across reads that change nothing', async () => {
    const a = await agentRead()
    const b = await agentRead()
    expect(a.version).toMatch(/^v1:[0-9a-f]{64}$/)
    expect(b.version).toBe(a.version)
  })

  it('changes on a same-ms stock write although updatedAt does not', async () => {
    const before = await agentRead()
    stockAddMetadata({ plugin: { x: 1 } })
    const after = await agentRead()
    expect(after.updatedAt).toBe(before.updatedAt)
    expect(after.version).not.toBe(before.version)
  })
})

describe('update_post(expectedVersion) through the real resolver', () => {
  it('get_post → same-ms stock metadata write → update_post(metadata, expectedVersion) ⇒ conflict, stock change intact', async () => {
    const seen = await agentRead()
    stockAddMetadata({ plugin: { x: 1 } }) // updatedAt stays T
    expect(table.item!.updatedAt).toBe(T)

    const c = client()
    await expect(
      updatePost(c, { postId: 'p1', metadata: { ...seen.metadata, mine: true }, expectedVersion: seen.version }),
    ).rejects.toThrow(/conflict.*Nothing was saved/s)
    expect(c.writes()).toBe(0)
    expect(table.item!.metadata).toEqual({ cache: 'deep', plugin: { x: 1 } })
  })

  it('a same-ms change landing after the tool re-read is caught by the resolver (conflict, nothing overwritten)', async () => {
    const seen = await agentRead()
    const c = client((n) => {
      if (n === 1) table.stockUpdate({ title: 'Theirs' })
    })
    await expect(updatePost(c, { postId: 'p1', title: 'Mine', expectedVersion: seen.version })).rejects.toThrow(/conflict/)
    expect(table.item!.title).toBe('Theirs')
  })

  it('a matching version succeeds, writes only the passed fields, and returns a new version', async () => {
    const seen = await agentRead()
    const out = await updatePost(client(), { postId: 'p1', excerpt: '', tags: ['x'], expectedVersion: seen.version })
    expect(out.updatedAt).toBe('2026-06-01T00:00:00.001Z') // strictly newer although the clock is frozen
    expect(out.version).not.toBe(seen.version)
    expect((await agentRead()).version).toBe(out.version)
    expect(table.item).toMatchObject({ excerpt: '', tags: ['x'], title: 'Weekly', metadata: { cache: 'deep' }, createdAt: T })
  })
})

describe('set_post_classes through the real resolver', () => {
  it('get_post → same-ms stock metadata write → set_post_classes(ids, expectedVersion) ⇒ conflict, stock change intact', async () => {
    const seen = await agentRead()
    stockAddMetadata({ plugin: { x: 1 } })
    const c = client()
    await expect(setPostClasses(c, { postId: 'p1', ids: ['wide'], expectedVersion: seen.version })).rejects.toThrow(/conflict/)
    expect(c.writes()).toBe(0)
    expect(table.item!.metadata).toEqual({ cache: 'deep', plugin: { x: 1 } })
  })

  it('ids with a matching version succeeds and returns a new version', async () => {
    const seen = await agentRead()
    const out = await setPostClasses(client(), { postId: 'p1', ids: ['wide'], expectedVersion: seen.version })
    expect(out.post.version).not.toBe(seen.version)
    expect(table.item!.metadata).toEqual({ cache: 'deep', [KEY]: tagged(['wide']) })
  })

  it('ids + expectedVersion: a same-ms write between the tool read and its write fails (no retry); the external key survives', async () => {
    const seen = await agentRead()
    const c = client((n) => {
      if (n === 1) stockAddMetadata({ plugin: { x: 1 } })
    })
    await expect(setPostClasses(c, { postId: 'p1', ids: ['wide'], expectedVersion: seen.version })).rejects.toThrow(/conflict/)
    expect(c.writes()).toBe(1)
    expect(table.item!.metadata).toEqual({ cache: 'deep', plugin: { x: 1 } })
  })

  it('add: a same-ms external write to another metadata key between read and write → conflict, retry, both kept', async () => {
    const c = client((n) => {
      if (n === 1) stockAddMetadata({ plugin: { x: 1 } }) // updatedAt stays T
    })
    const out = await setPostClasses(c, { postId: 'p1', add: ['wide'] })
    expect(c.writes()).toBe(2) // first attempt conflicted, the retry won
    expect(table.item!.metadata).toEqual({ cache: 'deep', plugin: { x: 1 }, [KEY]: tagged(['wide']) })
    expect(out.post.updatedAt).toBe('2026-06-01T00:00:00.001Z')
  })

  it('add racing a same-ms stock write of another key and a concurrent remove: every change is preserved', async () => {
    table.stockUpdate({ metadata: { cache: 'deep', [KEY]: tagged(['old']) } })
    let injected = false
    const c = client(() => {
      if (!injected) {
        injected = true
        stockAddMetadata({ plugin: 'keep' }) // lands between both tools' reads and their writes
      }
    })
    await Promise.all([
      setPostClasses(c, { postId: 'p1', add: ['wide'] }),
      setPostClasses(c, { postId: 'p1', remove: ['old'] }),
    ])
    expect(table.item!.metadata).toEqual({ cache: 'deep', plugin: 'keep', [KEY]: tagged(['wide']) })
  })

  it('two adds racing on the same read: one wins, the other re-applies on top; both ids and other keys kept', async () => {
    table.stockUpdate({ metadata: { cache: 'deep', plugin: 'keep' } })
    const c = client()
    const [a, b] = await Promise.all([
      setPostClasses(c, { postId: 'p1', add: ['wide'] }),
      setPostClasses(c, { postId: 'p1', add: ['serif'] }),
    ])
    expect(c.writes()).toBe(3) // one of the two conflicted once and retried
    expect(new Set([a.post.updatedAt, b.post.updatedAt]).size).toBe(2)
    const meta = table.item!.metadata as Record<string, unknown>
    expect(meta.cache).toBe('deep')
    expect(meta.plugin).toBe('keep')
    expect([tagged(['wide', 'serif']), tagged(['serif', 'wide'])]).toContainEqual(meta[KEY])
  })

  it('a delete between read and write → conflict, then "not found" on the re-read; the post is not resurrected', async () => {
    const c = client((n) => {
      if (n === 1) table.stockDelete()
    })
    await expect(setPostClasses(c, { postId: 'p1', add: ['wide'] })).rejects.toThrow(/not found/)
    expect(table.item).toBeNull()
  })
})
