// Tests for templates/_shared/amplify/data/update-post-if-unchanged.js,
// executed against the in-memory Post table in post-table-fake.js (which
// evaluates the resolver's real ConditionExpression / UpdateExpression with
// DynamoDB-like semantics). The clock is frozen in most tests so that the
// "same millisecond" interleavings that defeat an updatedAt-only condition
// are reproduced deterministically.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clock = vi.hoisted(() => ({ nowMs: 0 }))

vi.mock('@aws-appsync/utils', async () => {
  // @ts-expect-error -- untyped JS test support
  const fake = await import('./post-table-fake.js')
  return fake.appsyncUtilsMock(clock)
})

interface ResolverModule {
  request: (ctx: unknown) => Record<string, unknown>
  response: (ctx: unknown) => unknown
}
interface FakeTable {
  item: Record<string, unknown> | null
  writes: number
  runResolver: (resolver: ResolverModule, args: Record<string, unknown>) => Record<string, unknown>
  stockUpdate: (fields: Record<string, unknown>) => Record<string, unknown>
  stockDelete: () => void
}

const resolver = (await import(
  // @ts-expect-error -- untyped AppSync JS resolver
  '../../../../templates/_shared/amplify/data/update-post-if-unchanged.js'
)) as ResolverModule
const fake = (await import(
  // @ts-expect-error -- untyped JS test support
  './post-table-fake.js'
)) as {
  createFakePostTable: (item: Record<string, unknown> | null, c: typeof clock) => FakeTable
  evaluateCondition: (e: string, item: unknown, n: Record<string, string>, v: Record<string, unknown>) => boolean
  dynamoEquals: (a: unknown, b: unknown) => boolean
}

const T = '2026-06-01T00:00:00.000Z'
const T_MS = Date.parse(T)
const KEY = 'ampless:postClasses'
const tagged = (ids: string[]) => ({ kind: 'ampless.post-classes', version: 1, ids })

function storedRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    __typename: 'Post',
    postId: 'p1',
    slug: 'weekly',
    title: 'Weekly',
    excerpt: 'intro',
    format: 'markdown',
    body: 'hello',
    status: 'published',
    publishedAt: '2026-05-01T00:00:00.000Z',
    tags: ['a', 'b'],
    metadata: { cache: 'deep', seo: { title: 'SEO' } },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: T,
    ...over,
  }
}

// The post as the admin / MCP mappers hand it to a caller: every
// conditionable field, absent ones as null.
function readBack(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of ['title', 'slug', 'excerpt', 'format', 'body', 'status', 'publishedAt', 'tags', 'metadata', 'updatedAt']) {
    out[f] = item[f] ?? null
  }
  return out
}

function run(table: FakeTable, patch: Record<string, unknown>, expected: Record<string, unknown>) {
  return table.runResolver(resolver, {
    postId: 'p1',
    patch: JSON.stringify(patch),
    expected: JSON.stringify(expected),
  })
}

function errorOf(fn: () => unknown): { message: string; type?: string } {
  try {
    fn()
  } catch (e) {
    return e as { message: string; type?: string }
  }
  throw new Error('expected an error')
}

const CONFLICT = 'DynamoDB:ConditionalCheckFailedException'

beforeEach(() => {
  clock.nowMs = T_MS // frozen at the row's own updatedAt
})

describe('amplessUpdatePostIfUnchanged — same-millisecond interleavings', () => {
  it('(a) a stock write in the same ms as the read changes metadata → the stale save conflicts, the external metadata survives', () => {
    const table = fake.createFakePostTable(storedRow(), clock)
    const loaded = readBack(table.item!) // admin opens the editor at T
    // External unconditional writer, same millisecond: updatedAt stays T.
    table.stockUpdate({ metadata: { cache: 'deep', seo: { title: 'SEO' }, [KEY]: tagged(['wide']) } })
    expect(table.item!.updatedAt).toBe(T)

    const err = errorOf(() => run(table, { title: 'Edited', metadata: loaded.metadata }, loaded))
    expect(err.type).toBe(CONFLICT)
    expect(table.item!.metadata).toEqual({ cache: 'deep', seo: { title: 'SEO' }, [KEY]: tagged(['wide']) })
    expect(table.item!.title).toBe('Weekly')
  })

  it('(b) a same-ms write to another metadata key between read and write → conflict; re-read + retry keeps both keys', () => {
    const table = fake.createFakePostTable(storedRow(), clock)
    const read1 = readBack(table.item!)
    table.stockUpdate({ metadata: { ...(read1.metadata as object), plugin: 'x' } })

    const merged1 = { ...(read1.metadata as object), [KEY]: tagged(['wide']) }
    expect(errorOf(() => run(table, { metadata: merged1 }, { metadata: read1.metadata, format: read1.format, updatedAt: read1.updatedAt })).type).toBe(CONFLICT)

    const read2 = readBack(table.item!)
    const merged2 = { ...(read2.metadata as object), [KEY]: tagged(['wide']) }
    run(table, { metadata: merged2 }, { metadata: read2.metadata, format: read2.format, updatedAt: read2.updatedAt })
    expect(table.item!.metadata).toEqual({ cache: 'deep', seo: { title: 'SEO' }, plugin: 'x', [KEY]: tagged(['wide']) })
  })

  it('(c) two conditional writers racing on the same read → exactly one wins, the loser retries, no key is lost', () => {
    const table = fake.createFakePostTable(storedRow(), clock)
    const a = readBack(table.item!)
    const b = readBack(table.item!)
    run(table, { metadata: { ...(a.metadata as object), [KEY]: tagged(['wide']) } }, { metadata: a.metadata, updatedAt: a.updatedAt })
    expect(errorOf(() => run(table, { metadata: { ...(b.metadata as object), other: 1 } }, { metadata: b.metadata, updatedAt: b.updatedAt })).type).toBe(CONFLICT)
    const b2 = readBack(table.item!)
    run(table, { metadata: { ...(b2.metadata as object), other: 1 } }, { metadata: b2.metadata, updatedAt: b2.updatedAt })
    expect(table.item!.metadata).toEqual({ cache: 'deep', seo: { title: 'SEO' }, [KEY]: tagged(['wide']), other: 1 })
  })

  it('(d) a concurrent delete → conflict, the post is not resurrected', () => {
    const table = fake.createFakePostTable(storedRow(), clock)
    const loaded = readBack(table.item!)
    table.stockDelete()
    expect(errorOf(() => run(table, { title: 'x' }, loaded)).type).toBe(CONFLICT)
    expect(table.item).toBeNull()
  })

  it('(e) a successful write sets updatedAt strictly greater than the one read, even with the clock frozen', () => {
    const table = fake.createFakePostTable(storedRow(), clock)
    const out = run(table, { title: 'One' }, readBack(table.item!))
    expect(out.updatedAt).toBe('2026-06-01T00:00:00.001Z')
    const out2 = run(table, { title: 'Two' }, readBack(table.item!))
    expect(out2.updatedAt).toBe('2026-06-01T00:00:00.002Z')
    // A clock that is ahead wins.
    clock.nowMs = T_MS + 5000
    const out3 = run(table, { title: 'Three' }, readBack(table.item!))
    expect(out3.updatedAt).toBe('2026-06-01T00:00:05.000Z')
  })

  it('an updatedAt-only expectation would NOT have caught (a): the content fields are what make it safe', () => {
    const table = fake.createFakePostTable(storedRow(), clock)
    const loaded = readBack(table.item!)
    table.stockUpdate({ metadata: { changed: true } })
    // Conditioning only on updatedAt (metadata not expected) lets the write
    // through — documented: callers must send the fields they overwrite,
    // which the resolver enforces for every patched field.
    expect(errorOf(() => run(table, { metadata: {} }, { updatedAt: loaded.updatedAt })).message).toMatch(
      /expected\.metadata is required/,
    )
  })
})

describe('amplessUpdatePostIfUnchanged — update semantics', () => {
  it('SETs patched fields, REMOVEs null ones, keeps excerpt "" as a value, and leaves createdAt / __typename alone', () => {
    const table = fake.createFakePostTable(storedRow(), clock)
    const loaded = readBack(table.item!)
    run(table, { excerpt: '', metadata: null, tags: null, publishedAt: null, title: 'New' }, loaded)
    const item = table.item!
    expect(item.excerpt).toBe('')
    expect(item).not.toHaveProperty('metadata')
    expect(item).not.toHaveProperty('tags')
    expect(item).not.toHaveProperty('publishedAt')
    expect(item.title).toBe('New')
    expect(item.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(item.__typename).toBe('Post')
    expect(item.body).toBe('hello')
  })

  it('emits the constrained grammar and only the expression values it uses', () => {
    const table = fake.createFakePostTable(storedRow(), clock)
    const req = resolver.request({
      args: { postId: 'p1', patch: JSON.stringify({ title: 'x' }), expected: JSON.stringify({ title: 'Weekly', updatedAt: T }) },
    }) as { operation: string; key: unknown; update: { expression: string }; condition: { expression: string; expressionValues: Record<string, unknown> } }
    expect(req.operation).toBe('UpdateItem')
    expect(req.key).toEqual({ postId: 'p1' })
    expect(req.update.expression).toBe('SET #title = :p_title, #updatedAt = :p_updatedAt')
    expect(req.condition.expression).toBe('attribute_exists(#postId) AND #updatedAt = :e_updatedAt AND #title = :e_title')
    expect(req.condition.expressionValues).not.toHaveProperty(':NULL')
    expect(table.writes).toBe(0)
  })

  it('passes the DynamoDB error type through response()', () => {
    const err = errorOf(() =>
      resolver.response({ error: { message: 'The conditional request failed', type: CONFLICT }, args: {} }),
    )
    expect(err).toMatchObject({ message: 'The conditional request failed', type: CONFLICT })
  })
})

describe('amplessUpdatePostIfUnchanged — expected values mirror the read mappers', () => {
  it.each([
    ['format missing → read as markdown', { format: undefined }, { format: 'markdown' }],
    ['format NULL → read as markdown', { format: null }, { format: 'markdown' }],
    ['status missing → read as draft', { status: undefined }, { status: 'draft' }],
    ['tags missing → read as []', { tags: undefined }, { tags: [] }],
    ['tags NULL → read as []', { tags: null }, { tags: [] }],
    ['tags [] → read as []', { tags: [] }, { tags: [] }],
    ['excerpt missing → null', { excerpt: undefined }, { excerpt: null }],
    ['excerpt NULL → null', { excerpt: null }, { excerpt: null }],
    ['metadata missing → null', { metadata: undefined }, { metadata: null }],
    ['body NULL → null', { body: null }, { body: null }],
    ['metadata map in another key order', { metadata: { b: 2, a: { y: 1, x: 2 } } }, { metadata: { a: { x: 2, y: 1 }, b: 2 } }],
  ])('%s matches', (_label, stored, expectedOver) => {
    const row = storedRow()
    for (const [k, v] of Object.entries(stored)) {
      if (v === undefined) delete row[k]
      else row[k] = v
    }
    const table = fake.createFakePostTable(row, clock)
    run(table, { title: 'ok' }, { title: 'Weekly', ...expectedOver, updatedAt: T })
    expect(table.item!.title).toBe('ok')
  })

  it.each([
    ['stored html ≠ expected markdown', { format: 'html' }, { format: 'markdown' }],
    ['stored published ≠ expected draft', { status: 'published' }, { status: 'draft' }],
    ['stored excerpt "" ≠ expected null', { excerpt: '' }, { excerpt: null }],
    ['stored excerpt null ≠ expected ""', { excerpt: null }, { excerpt: '' }],
    ['tags order matters', { tags: ['a', 'b'] }, { tags: ['b', 'a'] }],
    ['tags with a null element (mapper drops it) is a false conflict', { tags: ['a', null] }, { tags: ['a'] }],
    ['metadata stored as a string (mapper reads undefined) is a false conflict', { metadata: 'oops' }, { metadata: null }],
    ['number vs string', { metadata: { n: 1 } }, { metadata: { n: '1' } }],
    ['missing map key', { metadata: { a: 1, b: 2 } }, { metadata: { a: 1 } }],
  ])('%s → conflict', (_label, stored, expectedOver) => {
    const table = fake.createFakePostTable(storedRow(stored), clock)
    expect(errorOf(() => run(table, { title: 'no' }, { title: 'Weekly', ...expectedOver, updatedAt: T })).type).toBe(CONFLICT)
    expect(table.item!.title).toBe('Weekly')
  })
})

describe('amplessUpdatePostIfUnchanged — validation', () => {
  const ok = { title: 'Weekly', slug: 'weekly', excerpt: 'intro', format: 'markdown', body: 'hello', status: 'published', publishedAt: '2026-05-01T00:00:00.000Z', tags: ['a', 'b'], metadata: { cache: 'deep', seo: { title: 'SEO' } }, updatedAt: T }

  it.each([
    ['unknown patch key', { nope: 1 }, ok, /unknown field "nope"/],
    ['unknown expected key', { title: 'x' }, { ...ok, createdAt: 'x' }, /expected has an unknown field "createdAt"/],
    ['empty patch', {}, ok, /at least one field/],
    ['bad format', { format: 'pdf' }, ok, /patch\.format must be one of/],
    ['bad status', { status: 'archived' }, ok, /patch\.status must be one of/],
    ['empty title', { title: '' }, ok, /patch\.title must be a non-empty string/],
    ['null slug', { slug: null }, ok, /patch\.slug cannot be null/],
    ['null format', { format: null }, ok, /patch\.format cannot be null/],
    ['non-string excerpt', { excerpt: 3 }, ok, /patch\.excerpt/],
    ['unparseable publishedAt', { publishedAt: 'soon' }, ok, /patch\.publishedAt/],
    ['tags not strings', { tags: ['a', 1] }, ok, /patch\.tags/],
    ['metadata array', { metadata: [] }, ok, /patch\.metadata/],
    ['missing expected.updatedAt', { title: 'x' }, { title: 'Weekly' }, /expected\.updatedAt is required/],
    ['unparseable expected.updatedAt', { title: 'x' }, { title: 'Weekly', updatedAt: 'later' }, /expected\.updatedAt must be/],
    ['patched field not expected', { title: 'x', slug: 'y' }, { title: 'Weekly', updatedAt: T }, /expected\.slug is required/],
    ['body without expected format', { body: 'x' }, { body: 'hello', updatedAt: T }, /expected\.format is required because patch sets body/],
    ['format without expected body', { format: 'html' }, { format: 'markdown', updatedAt: T }, /expected\.body is required because patch sets format/],
  ])('%s', (_label, patch, expected, message) => {
    const table = fake.createFakePostTable(storedRow(), clock)
    const err = errorOf(() => run(table, patch, expected))
    expect(err.type).toBe('AmplessValidationError')
    expect(err.message).toMatch(message)
    expect(table.writes).toBe(0)
  })

  it('rejects non-object patch / expected JSON', () => {
    const table = fake.createFakePostTable(storedRow(), clock)
    expect(errorOf(() => table.runResolver(resolver, { postId: 'p1', patch: '[]', expected: JSON.stringify(ok) })).message).toMatch(/patch must be a JSON object/)
    expect(errorOf(() => table.runResolver(resolver, { postId: 'p1', patch: '{"title":"x"}', expected: 'null' })).message).toMatch(/expected must be a JSON object/)
  })
})

describe('post-table-fake semantics', () => {
  it('compares maps order-insensitively and lists order-sensitively, with strict types', () => {
    expect(fake.dynamoEquals({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true)
    expect(fake.dynamoEquals([1, 2], [2, 1])).toBe(false)
    expect(fake.dynamoEquals({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(fake.dynamoEquals(1, '1')).toBe(false)
    expect(fake.dynamoEquals(null, null)).toBe(true)
  })

  it('rejects expressions outside the grammar', () => {
    expect(() => fake.evaluateCondition('#a <> :b', {}, { '#a': 'a' }, { ':b': 1 })).toThrow(/grammar/)
  })
})
