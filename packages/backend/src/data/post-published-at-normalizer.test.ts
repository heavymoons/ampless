import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canonicalizeAwsDateTime } from 'ampless'
import { PUBLISHED_AT_NORMALIZER_REQUEST_TEMPLATES } from './post-published-at-normalizer.js'

// The normalizer VTL runs inside AppSync, so it cannot be executed here.
// scripts/evaluate-published-at-normalizer.mjs evaluates it with the real
// AppSync engine (`aws appsync evaluate-mapping-template`) over a matrix
// of inputs and pins the results in the fixture read below. This test
// checks that the fixture belongs to the current template text and that
// the engine's output agrees with `canonicalizeAwsDateTime` — the
// function the admin UI, MCP and runtime use for the same values.

type Op = 'create' | 'update'
interface FixtureResult {
  op: Op
  name: string
  context: { arguments: { input: Record<string, unknown> }; stash: Record<string, unknown> }
  result:
    | { error: string }
    | { evaluationResult: unknown; stash: { transformedArgs: Record<string, unknown> } }
}
interface PipelineResult {
  op: Op
  name: string
  error?: { step: string; message: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dataRequest?: any
}
interface Fixture {
  templateSha256: Record<Op, string>
  generatedTemplateSha256: Record<string, string>
  postId: string
  results: FixtureResult[]
  pipeline: PipelineResult[]
}

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(
  readFileSync(join(here, 'post-published-at-normalizer.fixture.json'), 'utf8')
) as Fixture

const CANONICAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

// Inputs the AppSync engine accepts but `canonicalizeAwsDateTime` rejects:
// `parseISO8601ToEpochMilliSeconds` is case-insensitive for the `T` / `Z`
// designators. The engine still emits a canonical value — the one JS
// gives for the upper-cased input. (Whether AppSync's AWSDateTime scalar
// lets a lowercase designator reach the resolver at all is not verified.)
const ACCEPTED_ONLY_BY_APPSYNC = new Set(['lowercase z', 'lowercase t'])

const transformedInput = (r: FixtureResult) => {
  if ('error' in r.result) throw new Error(`${r.op} ${r.name}: unexpected error ${r.result.error}`)
  return r.result.stash.transformedArgs.input as Record<string, unknown>
}
const byName = (op: Op, name: string) => {
  const r = fixture.results.find((x) => x.op === op && x.name === name)
  if (!r) throw new Error(`fixture has no ${op} case "${name}"`)
  return r
}
const ops: Op[] = ['create', 'update']

describe('publishedAt normalizer VTL — evaluated fixture', () => {
  it('was generated from the current template text (re-run the evaluate script otherwise)', () => {
    for (const op of ops) {
      const hash = createHash('sha256')
        .update(PUBLISHED_AT_NORMALIZER_REQUEST_TEMPLATES[op])
        .digest('hex')
      expect(fixture.templateSha256[op], op).toBe(hash)
    }
  })

  it('covers the same matrix for create and update', () => {
    const names = (op: Op) => fixture.results.filter((r) => r.op === op).map((r) => r.name)
    expect(names('create').length).toBeGreaterThan(30)
    expect(names('update')).toEqual(names('create'))
  })

  const stringCases = fixture.results.filter(
    (r) =>
      typeof r.context.arguments.input.publishedAt === 'string' && !r.context.stash.transformedArgs
  )

  it.each(stringCases.map((r) => [r.op, r.name, r] as const))(
    '%s %s: agrees with canonicalizeAwsDateTime',
    (_op, name, r) => {
      const raw = r.context.arguments.input.publishedAt as string
      const js = canonicalizeAwsDateTime(raw)
      if ('error' in r.result) {
        expect(r.result.error).toBe(`publishedAt is not a valid AWSDateTime: ${raw}`)
        // Nothing the JS side accepts is rejected by AppSync.
        expect(js).toBe(undefined)
        return
      }
      const input = transformedInput(r)
      expect(input.publishedAt).toMatch(CANONICAL)
      expect(input.publishedAtSortKey).toBe(`${input.publishedAt}#${fixture.postId}`)
      if (ACCEPTED_ONLY_BY_APPSYNC.has(name)) {
        expect(js).toBe(undefined)
        expect(input.publishedAt).toBe(canonicalizeAwsDateTime(raw.toUpperCase()))
      } else {
        expect(input.publishedAt).toBe(js)
      }
    }
  )

  it('rejects the cases the issue calls out', () => {
    for (const op of ops) {
      for (const name of [
        '+19:00',
        'second 60',
        'Feb 30',
        'before year 0000',
        '9999-12-31 overflow via offset',
      ]) {
        expect(byName(op, name).result, `${op} ${name}`).toHaveProperty('error')
      }
      expect(transformedInput(byName(op, 'year 0000')).publishedAt).toBe('0000-01-01T00:00:00.000Z')
    }
  })

  it('null: update removes both attributes, create writes no sort key', () => {
    expect(transformedInput(byName('update', 'publishedAt null'))).toEqual({
      postId: fixture.postId,
      publishedAt: null,
      publishedAtSortKey: null,
    })
    expect(transformedInput(byName('create', 'publishedAt null'))).toEqual({
      postId: fixture.postId,
      publishedAt: null,
    })
  })

  it('absent publishedAt leaves the input unchanged', () => {
    for (const op of ops) {
      expect(transformedInput(byName(op, 'publishedAt absent'))).toEqual({
        postId: fixture.postId,
        title: 'T',
      })
    }
  })

  it('always drops a client-supplied publishedAtSortKey', () => {
    for (const op of ops) {
      expect(transformedInput(byName(op, 'client publishedAtSortKey, publishedAt absent'))).toEqual(
        { postId: fixture.postId }
      )
      expect(
        transformedInput(byName(op, 'client publishedAtSortKey, publishedAt set'))
          .publishedAtSortKey
      ).toBe(`2026-05-01T00:00:00.000Z#${fixture.postId}`)
      expect(transformedInput(byName(op, 'client publishedAtSortKey, publishedAt null'))).toEqual(
        op === 'update'
          ? { postId: fixture.postId, publishedAt: null, publishedAtSortKey: null }
          : { postId: fixture.postId, publishedAt: null }
      )
    }
  })

  it('starts from an earlier transformedArgs and keeps the rest of the stash', () => {
    for (const op of ops) {
      const r = byName(op, 'existing transformedArgs in stash')
      if ('error' in r.result) throw new Error(r.result.error)
      expect(r.result.stash).toEqual({
        other: 'kept',
        transformedArgs: {
          input: {
            postId: fixture.postId,
            publishedAt: '2026-05-01T00:00:00.000Z',
            publishedAtSortKey: `2026-05-01T00:00:00.000Z#${fixture.postId}`,
            title: 'from stash',
          },
        },
      })
    }
  })

  it('keeps the other arguments (condition)', () => {
    for (const op of ops) {
      const r = byName(op, 'condition argument preserved')
      if ('error' in r.result) throw new Error(r.result.error)
      expect(r.result.stash.transformedArgs.condition).toEqual({ status: { eq: 'draft' } })
    }
  })

  it('returns an empty NONE-data-source request for every accepted case', () => {
    for (const r of fixture.results) {
      if ('error' in r.result) continue
      expect(r.result.evaluationResult, `${r.op} ${r.name}`).toEqual({
        version: '2018-05-29',
        payload: {},
      })
    }
  })
})

// The normalizer chained between Amplify's generated init / preAuth and
// data functions (see the evaluate script). backend.published-at.test.ts
// checks that the generated templates pinned here are the ones a synth
// produces today.
describe('publishedAt normalizer VTL — in the generated pipeline', () => {
  const pipeline = (op: Op, name: string) => {
    const r = fixture.pipeline.find((x) => x.op === op && x.name === name)
    if (!r) throw new Error(`fixture has no pipeline ${op} case "${name}"`)
    if (r.error && name !== 'invalid publishedAt') throw new Error(JSON.stringify(r.error))
    return r
  }
  const id = fixture.postId
  const putItem = (name: string) => {
    const req = pipeline('create', name).dataRequest
    expect(req.operation).toBe('PutItem')
    return req.attributeValues as Record<string, unknown>
  }
  const updateItem = (name: string) => {
    const req = pipeline('update', name).dataRequest
    expect(req.operation).toBe('UpdateItem')
    return req.update as {
      expression: string
      expressionNames: Record<string, string>
      expressionValues: Record<string, unknown>
    }
  }

  it('pins the generated createPost / updatePost templates it ran against', () => {
    for (const op of ops) {
      for (const step of ['init.1.req', 'preAuth.1.req', 'req']) {
        expect(fixture.generatedTemplateSha256).toHaveProperty([`Mutation.${op}Post.${step}.vtl`])
      }
    }
  })

  it('writes the canonical publishedAt and derived sort key, never the forged one', () => {
    const put = putItem('+09:00 with forged sort key')
    expect(put.publishedAt).toEqual({ S: '2026-05-01T00:00:00.000Z' })
    expect(put.publishedAtSortKey).toEqual({ S: `2026-05-01T00:00:00.000Z#${id}` })

    const update = updateItem('+09:00 with forged sort key')
    expect(update.expression).toMatch(/^SET /)
    expect(update.expressionValues[':publishedAt']).toEqual({ S: '2026-05-01T00:00:00.000Z' })
    expect(update.expressionValues[':publishedAtSortKey']).toEqual({
      S: `2026-05-01T00:00:00.000Z#${id}`,
    })
  })

  it('drops a forged sort key that preAuth merged into stash.defaultValues', () => {
    // Without publishedAt the normalizer writes no key of its own, so
    // only the defaultValues scrub keeps the forged value out.
    const put = putItem('publishedAt absent with forged sort key')
    expect(put).not.toHaveProperty('publishedAtSortKey')
    expect(put).not.toHaveProperty('publishedAt')
    const update = updateItem('publishedAt absent with forged sort key')
    expect(JSON.stringify(update)).not.toContain('publishedAtSortKey')
    expect(JSON.stringify(update)).not.toContain('forged')
  })

  it('null publishedAt: update REMOVEs both, create writes no sort key', () => {
    const update = updateItem('publishedAt null with forged sort key')
    expect(update.expression).toMatch(/REMOVE .*#publishedAtSortKey/)
    expect(update.expression).toMatch(/REMOVE .*#publishedAt\b/)
    expect(update.expressionValues).not.toHaveProperty(':publishedAtSortKey')
    const put = putItem('publishedAt null with forged sort key')
    expect(put).not.toHaveProperty('publishedAtSortKey')
    // Pre-existing Amplify behaviour, unchanged here: create passes the
    // explicit null through.
    expect(put.publishedAt).toEqual({ NULL: null })
  })

  it('an invalid publishedAt stops the pipeline before the data function', () => {
    for (const op of ops) {
      const r = pipeline(op, 'invalid publishedAt')
      expect(r.error).toEqual({
        step: 'normalizer',
        message: 'publishedAt is not a valid AWSDateTime: 2026-02-30T00:00:00Z',
      })
      expect(r.dataRequest).toBe(undefined)
    }
  })

  it('keeps the condition argument in the data request', () => {
    for (const op of ops) {
      const r = pipeline(op, 'condition argument preserved')
      expect(r.dataRequest.condition.expression).toContain('#status = :and_')
      expect(Object.values(r.dataRequest.condition.expressionValues)).toEqual([{ S: 'draft' }])
    }
    expect(putItem('condition argument preserved').publishedAtSortKey).toEqual({
      S: `2026-05-01T14:00:00.000Z#${id}`,
    })
  })
})
