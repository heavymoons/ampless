import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DescribeTableCommandOutput } from '@aws-sdk/client-dynamodb'
import {
  DeleteCommand,
  GetCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { runCli, USAGE, type CliClients } from './cli-main.js'
import { evaluatePostStateCondition, guardCancelled } from '../__fixtures__/post-state-condition.js'

// Every client is a fake; no AWS SDK client is constructed and nothing
// leaves the process.

const POSTS = 'Post-abc-NONE'
const TAGS = 'PostTag-abc-NONE'
const CANONICAL = '2026-05-01T00:00:00.000Z'

const READY: DescribeTableCommandOutput['Table'] = {
  TableStatus: 'ACTIVE',
  GlobalSecondaryIndexes: [{ IndexName: 'byStatusSorted', IndexStatus: 'ACTIVE' }],
}
const BACKFILLING: DescribeTableCommandOutput['Table'] = {
  TableStatus: 'ACTIVE',
  GlobalSecondaryIndexes: [
    { IndexName: 'byStatusSorted', IndexStatus: 'ACTIVE', Backfilling: true },
  ],
}

function harness(opts: {
  table?: DescribeTableCommandOutput['Table']
  posts?: Array<Record<string, unknown>>
  tagRows?: Array<Record<string, unknown>>
}) {
  const posts = new Map((opts.posts ?? []).map((p) => [p.postId as string, { ...p }]))
  const tags = new Map(
    (opts.tagRows ?? []).map((r) => [`${String(r.tag)}|${String(r.publishedAtPostId)}`, { ...r }])
  )
  const commands: string[] = []
  const stdout: string[] = []
  const stderr: string[] = []
  const clients: CliClients = {
    raw: {
      async send() {
        commands.push('DescribeTable')
        return { Table: opts.table, $metadata: {} }
      },
    },
    doc: {
      async send(command) {
        const input = command.input as Record<string, unknown>
        if (command instanceof ScanCommand) {
          commands.push(`Scan ${String(input.TableName)}`)
          const src = input.TableName === POSTS ? posts : tags
          return { Items: [...src.values()].map((r) => ({ ...r })) }
        }
        if (command instanceof UpdateCommand) {
          commands.push('Update')
          const values = input.ExpressionAttributeValues as Record<string, unknown>
          const row = posts.get((input.Key as { postId: string }).postId)!
          row.publishedAt = values[':canonical']
          row.publishedAtSortKey = values[':sortKey']
          return {}
        }
        if (command instanceof GetCommand) {
          commands.push('Get')
          const row = posts.get((input.Key as { postId: string }).postId)
          return row ? { Item: { ...row } } : {}
        }
        if (command instanceof TransactWriteCommand) {
          commands.push('Transact')
          const [check, put] = input.TransactItems as Array<Record<string, Record<string, unknown>>>
          const key = check!.ConditionCheck!.Key as { postId: string }
          if (!evaluatePostStateCondition(posts.get(key.postId) ?? null, check!.ConditionCheck!)) {
            throw guardCancelled()
          }
          const item = put!.Put!.Item as Record<string, unknown>
          tags.set(`${String(item.tag)}|${String(item.publishedAtPostId)}`, { ...item })
          return {}
        }
        if (command instanceof DeleteCommand) {
          commands.push('Delete')
          const key = input.Key as Record<string, unknown>
          tags.delete(`${String(key.tag)}|${String(key.publishedAtPostId)}`)
          return {}
        }
        throw new Error('unexpected command')
      },
    },
  }
  const createClients = vi.fn(() => clients)
  return {
    commands,
    stdout,
    stderr,
    tags,
    createClients,
    run: (argv: string[]) =>
      runCli(argv, {
        createClients,
        stdout: (l) => stdout.push(l),
        stderr: (l) => stderr.push(l),
      }),
  }
}

const rawPost = {
  postId: 'p1',
  slug: 'hello',
  title: 'Hello',
  status: 'published',
  publishedAt: '2026-05-01T09:00:00+09:00',
  tags: ['news'],
}

describe('runCli', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('--help prints the usage (with exit codes and the completion caveat) and exits 0', async () => {
    const h = harness({})
    expect(await h.run(['--help'])).toBe(0)
    expect(h.stdout).toEqual([USAGE])
    expect(USAGE).toContain('--check-post-tags')
    expect(USAGE).toContain('Exit codes:')
    expect(USAGE).toContain('does NOT by itself prove')
    expect(USAGE).toContain('only on publishedAt / publishedAtSortKey')
    // The throttle is described as it behaves: before each call, no burst.
    expect(USAGE).toContain("including within one post's rebuild; no burst")
    expect(h.createClients).not.toHaveBeenCalled()
  })

  it.each([
    [[], /--table is required/],
    [['--table', POSTS, '--check-post-tags'], /--post-tag-table is required/],
    [['--table', POSTS, '--post-tag-table', TAGS], /only used with --check-post-tags/],
    [['--table', POSTS, '--max-writes-per-second', '0'], /positive number/],
    [['--bogus'], /Unknown option/],
  ])('usage error %j → exit 2', async (argv, message) => {
    const h = harness({})
    expect(await h.run(argv as string[])).toBe(2)
    expect(h.stderr.join('\n')).toMatch(message)
    expect(h.commands).toEqual([])
  })

  it('--apply is refused (exit 1, no scan / write) while byStatusSorted is backfilling', async () => {
    const h = harness({ table: BACKFILLING, posts: [rawPost] })
    expect(await h.run(['--table', POSTS, '--apply'])).toBe(1)
    expect(h.commands).toEqual(['DescribeTable'])
    expect(h.stderr.join('\n')).toContain('Refusing --apply')
    expect(h.stdout.join('\n')).toContain('still backfilling')
  })

  it('--apply is refused when DescribeTable fails (logged)', async () => {
    const h = harness({ posts: [rawPost] })
    const clients = h.createClients()
    clients.raw.send = async () => {
      throw new Error('AccessDeniedException')
    }
    h.createClients.mockReturnValue(clients)
    expect(await h.run(['--table', POSTS, '--apply'])).toBe(1)
    expect(h.commands).toEqual([])
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('preflight DescribeTable failed'),
      expect.anything()
    )
  })

  it('dry-run reports a failed preflight but still runs the read-only scan (exit 0)', async () => {
    const h = harness({ table: BACKFILLING, posts: [rawPost] })
    expect(await h.run(['--table', POSTS])).toBe(0)
    expect(h.commands).toEqual(['DescribeTable', `Scan ${POSTS}`])
    const out = h.stdout.join('\n')
    expect(out).toContain('preflight problem: GSI byStatusSorted is still backfilling')
    expect(out).toContain('--apply would be refused')
  })

  it('--apply with a ready table writes and prints the completion caveat', async () => {
    const h = harness({ table: READY, posts: [rawPost] })
    expect(await h.run(['--table', POSTS, '--apply'])).toBe(0)
    expect(h.commands).toEqual(['DescribeTable', `Scan ${POSTS}`, 'Update'])
    expect(h.stdout.join('\n')).toContain('does not by itself prove completion')
  })

  it('--json puts the summary (with the preflight) alone on stdout', async () => {
    const h = harness({ table: READY, posts: [rawPost] })
    expect(await h.run(['--table', POSTS, '--json'])).toBe(0)
    expect(h.stdout).toHaveLength(1)
    const parsed = JSON.parse(h.stdout[0]!)
    expect(parsed).toMatchObject({ apply: false, toRewrite: 1, preflight: { ok: true } })
  })

  describe('--check-post-tags', () => {
    const canonicalPost = { ...rawPost, publishedAt: CANONICAL, status: 'draft', title: 'Draft' }
    const staleRow = {
      tag: 'news',
      publishedAtPostId: `${CANONICAL}#p1`,
      postId: 'p1',
      publishedAt: CANONICAL,
      slug: 'hello',
      title: 'Draft',
      tags: ['news'],
    }
    const args = ['--check-post-tags', '--table', POSTS, '--post-tag-table', TAGS]

    it('dry-run with mismatches → exit 1, no writes, no DescribeTable', async () => {
      const h = harness({ posts: [canonicalPost], tagRows: [staleRow] })
      expect(await h.run(args)).toBe(1)
      expect(h.commands).toEqual([`Scan ${TAGS}`, `Scan ${POSTS}`])
      const out = h.stdout.join('\n')
      expect(out).toContain('STALE tag=news')
      expect(out).toContain('1 mismatch(es) found')
    })

    it('dry-run on consistent tables → exit 0', async () => {
      const h = harness({ posts: [canonicalPost], tagRows: [] })
      expect(await h.run(args)).toBe(0)
    })

    it('--apply repairs and exits 0 once the re-check is clean', async () => {
      const h = harness({ posts: [canonicalPost], tagRows: [staleRow] })
      expect(await h.run([...args, '--apply'])).toBe(0)
      expect(h.tags.size).toBe(0)
      expect(h.commands).toContain('Delete')
      expect(h.stdout.join('\n')).toContain('remaining:         0')
    })

    it('--apply exits 1 when mismatches remain after the repair', async () => {
      const h = harness({ posts: [canonicalPost], tagRows: [staleRow] })
      const clients = h.createClients()
      const realSend = clients.doc.send.bind(clients.doc)
      // Deletes silently do nothing (e.g. a writer keeps recreating the row).
      clients.doc.send = async (command) => {
        if (command instanceof DeleteCommand) return {}
        return realSend(command as never)
      }
      h.createClients.mockReturnValue(clients)
      expect(await h.run([...args, '--apply'])).toBe(1)
      expect(h.stdout.join('\n')).toContain('remain after the repair')
    })
  })
})
