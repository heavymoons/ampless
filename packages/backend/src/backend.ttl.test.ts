import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AmplessBackend } from './backend.js'
import { CUSTOM_MODEL_NAME } from './__fixtures__/amplify/data/resource.js'
import {
  AMPLESS_MODELS,
  TABLE_MANAGER_HANDLER,
  setBackendNamespace,
  synthAmpless,
  synthWithInertSetter,
  type Synthesized,
} from './__fixtures__/synth.js'

// DynamoDB TTL on KvStore / PostHistory (#399) — verified against REAL
// synthesized CloudFormation (see __fixtures__/synth.ts) and the real
// Amplify table-manager handler.
//
// TTL is deliberately OFF by default: enabling it on an existing site
// deletes every row whose `ttl` already passed, irreversibly. Sites opt
// in per table from amplify/backend.custom.ts via the wrapper's
// `timeToLiveAttribute` setter after the RUNBOOK audit.

setBackendNamespace('amplessttltest')

const TTL_ON = { attributeName: 'ttl', enabled: true }
const TTL_MODELS = ['KvStore', 'PostHistory']

const here = dirname(fileURLToPath(import.meta.url))

const tablesOf = (backend: AmplessBackend) =>
  backend.data.resources.cfnResources.amplifyDynamoDbTables

/** Same shape as amplify/backend.custom.ts' customizeBackend(backend). */
function optIn(models: string[]) {
  return (backend: AmplessBackend) => {
    for (const model of models) tablesOf(backend)[model].timeToLiveAttribute = TTL_ON
  }
}

/**
 * What earlier releases did in backend.ts: assign `timeToLiveSpecification`
 * — not a setter on the wrapper, so it only creates a plain JS property.
 */
function legacyAssignment(backend: AmplessBackend) {
  for (const model of TTL_MODELS) {
    ;(tablesOf(backend)[model] as unknown as Record<string, unknown>).timeToLiveSpecification =
      TTL_ON
  }
}

describe('defineAmplessBackend — DynamoDB TTL (opt-in)', () => {
  let current: Synthesized
  let baseline: Synthesized

  beforeAll(() => {
    current = synthAmpless()
    // The previous release: its inert assignments replayed, with the real
    // TTL setter neutralised as well — no code path enables TTL.
    baseline = synthWithInertSetter('timeToLiveAttribute', legacyAssignment)
  }, 300_000)

  afterEach(() => vi.restoreAllMocks())

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handler: any
  beforeAll(() => {
    if (!existsSync(TABLE_MANAGER_HANDLER)) {
      throw new Error(
        `Amplify table-manager handler not found at ${TABLE_MANAGER_HANDLER}. ` +
          'The @aws-amplify/graphql-api-construct layout changed — update this path ' +
          'and re-verify how UpdateTimeToLive is driven by timeToLiveSpecification.'
      )
    }
    handler = createRequire(TABLE_MANAGER_HANDLER)(TABLE_MANAGER_HANDLER)
    expect(typeof handler.isTtlModified).toBe('function')
    expect(typeof handler.getTtlUpdate).toBe('function')
  })

  describe('a. default: no table gets TTL, template identical to the previous release', () => {
    it('covers all ampless models plus the project (custom) model', () => {
      expect(Object.keys(current.tables)).toEqual(
        expect.arrayContaining([...AMPLESS_MODELS, CUSTOM_MODEL_NAME])
      )
    })

    it('emits no timeToLiveSpecification on any table', () => {
      for (const [model, props] of Object.entries(current.tables)) {
        expect(props, model).not.toHaveProperty('timeToLiveSpecification')
      }
    })

    it('equals the previous-release baseline (every table prop and every stack resource)', () => {
      expect(current.tables).toEqual(baseline.tables)
      expect(current.inventory).toEqual(baseline.inventory)
      expect(Object.keys(current.inventory).some((p) => p.includes('data'))).toBe(true)
    })
  })

  describe('b. upgrade leaves a hand-enabled TTL alone (real handler)', () => {
    it('isTtlModified(undefined, undefined) is false, so UpdateTimeToLive is never called', () => {
      for (const model of TTL_MODELS) {
        // old = previous release props, new = this release props.
        expect(
          handler.isTtlModified(
            baseline.tables[model].timeToLiveSpecification,
            current.tables[model].timeToLiveSpecification
          ),
          model
        ).toBe(false)
      }
    })
  })

  describe('c. opt-in from backend.custom.ts', () => {
    let postHistoryOnly: Synthesized
    let both: Synthesized
    beforeAll(() => {
      postHistoryOnly = synthAmpless(optIn(['PostHistory']))
      both = synthAmpless(optIn(TTL_MODELS))
    }, 300_000)

    it('emits exactly { attributeName: "ttl", enabled: true } on the chosen table only', () => {
      expect(postHistoryOnly.tables['PostHistory'].timeToLiveSpecification).toEqual(TTL_ON)
      for (const [model, props] of Object.entries(postHistoryOnly.tables)) {
        if (model === 'PostHistory') continue
        expect(props, model).toEqual(current.tables[model])
      }
    })

    it('works for KvStore too, and changes nothing else on either table', () => {
      for (const model of TTL_MODELS) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { timeToLiveSpecification, ...rest } = both.tables[model]
        expect(timeToLiveSpecification, model).toEqual(TTL_ON)
        expect(rest, model).toEqual(current.tables[model])
      }
      expect(both.inventory).toEqual(current.inventory)
    })

    it('handler: enabling is a modification that turns TTL on for a DISABLED table', () => {
      for (const model of TTL_MODELS) {
        const props = both.tables[model]
        expect(handler.isTtlModified(undefined, props.timeToLiveSpecification), model).toBe(true)
        expect(handler.getTtlUpdate({ TimeToLiveStatus: 'DISABLED' }, props), model).toEqual({
          TableName: props.tableName,
          TimeToLiveSpecification: { Enabled: true, AttributeName: 'ttl' },
        })
      }
    })

    it('handler: removing the opt-in later turns TTL back off', () => {
      for (const model of TTL_MODELS) {
        const before = both.tables[model]
        const after = current.tables[model]
        expect(
          handler.isTtlModified(before.timeToLiveSpecification, after.timeToLiveSpecification),
          model
        ).toBe(true)
        expect(
          handler.getTtlUpdate({ TimeToLiveStatus: 'ENABLED', AttributeName: 'ttl' }, after),
          model
        ).toEqual({
          TableName: after.tableName,
          TimeToLiveSpecification: { Enabled: false, AttributeName: 'ttl' },
        })
      }
    })
  })

  describe('d. the property name matters', () => {
    it('assigning `timeToLiveSpecification` (no setter) leaves the template without TTL', () => {
      const legacy = synthAmpless(legacyAssignment)
      for (const model of TTL_MODELS) {
        expect(legacy.tables[model], model).not.toHaveProperty('timeToLiveSpecification')
      }
      expect(legacy.tables).toEqual(current.tables)
    }, 300_000)
  })
})

// The template RUNBOOKs carry the controlled migration for turning TTL
// on. Guard its load-bearing steps in both languages: the read-only audit,
// keeping rows by removing/raising `ttl` first, the PITR safety net, the
// correct setter name, and monitoring. A scan is not a snapshot, so the
// writer freeze must come before the first audit, and the re-audit before
// the opt-in deploy and the verification after it; every `update-item`
// must be conditional so it cannot recreate a deleted row or clobber a
// newer `ttl`.
describe('template RUNBOOK TTL section', () => {
  const sharedDir = join(here, '../../../templates/_shared')
  const section = (file: string) => {
    const text = readFileSync(join(sharedDir, file), 'utf8')
    const start = text.search(/^### DynamoDB TTL/m)
    expect(start, `${file}: TTL section heading`).toBeGreaterThanOrEqual(0)
    const end = text.indexOf('\n### ', start + 1)
    return text.slice(start, end === -1 ? undefined : end)
  }

  const LANG: Record<
    string,
    {
      iteratorAgeNotProof: string
      mappingNotProof: string
      noZeroHeading: string
      neverExpire: string
    }
  > = {
    'RUNBOOK.md': {
      iteratorAgeNotProof: '**not proof on its own**',
      mappingNotProof:
        'Neither `State` nor\n     `LastProcessingResult` proves the stream is drained on its own',
      noZeroHeading: "Don't switch `retentionDays` to 0 for the window",
      neverExpire: 'those revisions never expire',
    },
    'RUNBOOK.ja.md': {
      iteratorAgeNotProof: '**それだけでは証明になりません**',
      mappingNotProof:
        '`State` も `LastProcessingResult` も、それだけではストリームを処理し終えた証明になりません',
      noZeroHeading: '作業中に `retentionDays` を 0 にしない',
      neverExpire: 'それらのリビジョンは期限切れになりません',
    },
  }

  for (const file of ['RUNBOOK.md', 'RUNBOOK.ja.md']) {
    it(`${file} documents the audit, PITR safety net, opt-in and monitoring`, () => {
      const s = section(file)
      for (const needle of [
        'describe-time-to-live',
        'attribute_exists(#t)',
        '--select COUNT',
        'REMOVE #t',
        'describe-continuous-backups',
        'EarliestRestorableDateTime',
        'timeToLiveAttribute',
        "{ attributeName: 'ttl', enabled: true }",
        'TimeToLiveDeletedItemCount',
        'retentionDays',
        'ttlSeconds',
        // Writer pause, verified by more than one signal.
        'ConsumedWriteCapacityUnits',
        'list-event-source-mappings',
        'LastProcessingResult',
        'Invocations',
        'ConcurrentExecutions',
        'IteratorAge',
        // Conditional fixes and their failure handling.
        "--condition-expression 'attribute_exists(postHistoryId) AND #t = :seen'",
        'attribute_exists(pk)',
        'ConditionalCheckFailedException',
        'get-item --consistent-read',
        // Consistent audits: before, immediately before deploy, after deploy.
        '--consistent-read',
        'ttl-audit-1.json',
        'ttl-audit-2.json',
        'ttl-audit-3.json',
        'ENABLING',
      ]) {
        expect(s, needle).toContain(needle)
      }
      // Links to the PITR restore section rather than repeating it.
      expect(s).toMatch(/\]\(#[^)]*(point-in-time-recovery|ポイントインタイムリカバリ)[^)]*\)/)
    })

    it(`${file} orders freeze → audit → re-audit → opt-in → verify → resume`, () => {
      const s = section(file)
      const at = (needle: string) => {
        const i = s.indexOf(needle)
        expect(i, needle).toBeGreaterThanOrEqual(0)
        return i
      }
      const order = [
        at('list-event-source-mappings'),
        at('ttl-audit-1.json'),
        at('ttl-audit-2.json'),
        at("{ attributeName: 'ttl', enabled: true }"),
        at('ttl-audit-3.json'),
        // Writers resume only after the post-deploy verification.
        s.search(/\*\*(Resume the writers|書き込み元を再開します)/),
      ]
      expect(order.at(-1)).toBeGreaterThanOrEqual(0)
      expect(order).toEqual([...order].sort((a, b) => a - b))
    })

    it(`${file} does not treat IteratorAge alone as proof the dispatcher is idle`, () => {
      expect(section(file)).toContain(LANG[file].iteratorAgeNotProof)
    })

    it(`${file} accepts the idle-stream LastProcessingResult and does not treat it as proof`, () => {
      const s = section(file)
      // An idle stream legitimately reports "No records processed"; a
      // runbook that only accepts `OK` would block (or mislead) operators.
      expect(s).toMatch(/`LastProcessingResult`[^\n]*\n?[^\n]*`OK`[^`]*`No records processed`/)
      expect(s).toContain(LANG[file].mappingNotProof)
    })

    it(`${file} pauses writers instead of switching retentionDays to 0, and says why`, () => {
      const s = section(file)
      const step1 = s.slice(s.indexOf('\n1. **'), s.indexOf('\n2. **'))
      expect(step1.length).toBeGreaterThan(0)
      // Step 1 must not tell the operator to deploy retentionDays: 0.
      expect(step1).not.toContain('retentionDays: 0')
      expect(step1).toContain(LANG[file].noZeroHeading)
      // The note spells out the permanent consequence and the deliberate fix.
      const note = s.slice(s.indexOf(`**${LANG[file].noZeroHeading}`))
      expect(note).toContain(LANG[file].neverExpire)
      expect(note).toContain(
        "--condition-expression 'attribute_exists(postHistoryId) AND attribute_not_exists(#t)'"
      )
    })

    it(`${file} makes every update-item conditional on the row and the observed ttl`, () => {
      const blocks = [...section(file).matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1])
      const updates = blocks.filter((b) => b.includes('update-item'))
      expect(updates.length).toBeGreaterThan(0)
      for (const b of updates) {
        expect(b).toMatch(/--condition-expression '[^']*attribute_exists\([^)]+\) AND #t = :seen'/)
      }
    })
  }
})
