import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CUSTOM_MODEL_NAME } from './__fixtures__/amplify/data/resource.js'
import {
  AMPLESS_MODELS,
  TABLE_MANAGER_HANDLER,
  setBackendNamespace,
  synthAmpless,
  synthWithInertSetter,
  type Synthesized,
} from './__fixtures__/synth.js'

// DynamoDB point-in-time recovery (#395) — verified against REAL
// synthesized CloudFormation: the full `defineAmplessBackend` (real
// defineAuth / defineData / defineStorage + the ampless schema) is
// synthesized and the AmplifyDynamoDBTable custom resources are read
// back from the nested-stack templates (see __fixtures__/synth.ts).

setBackendNamespace('amplesspitrtest')

const PITR_ON = { pointInTimeRecoveryEnabled: true }

const here = dirname(fileURLToPath(import.meta.url))

/** The previous release: identical wiring, but the PITR setter is inert. */
function synthBaseline(): Synthesized {
  return synthWithInertSetter('pointInTimeRecoveryEnabled')
}

function withoutPitr(props: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { pointInTimeRecoverySpecification, ...rest } = props
  return rest
}

// ---------------------------------------------------------------------------

describe('defineAmplessBackend — DynamoDB point-in-time recovery', () => {
  let current: Synthesized
  let baseline: Synthesized

  beforeAll(() => {
    current = synthAmpless()
    baseline = synthBaseline()
  }, 300_000)

  afterEach(() => vi.restoreAllMocks())

  describe('a. every model table has PITR enabled', () => {
    it('covers all ampless models plus the project (custom) model', () => {
      const models = Object.keys(current.tables)
      expect(models).toEqual(expect.arrayContaining([...AMPLESS_MODELS, CUSTOM_MODEL_NAME]))
    })

    it('emits a literal camelCase spec (what the table-manager handler reads), not the Fn::If default', () => {
      for (const [model, props] of Object.entries(current.tables)) {
        expect(props.pointInTimeRecoverySpecification, model).toEqual(PITR_ON)
      }
    })

    it('baseline (setter neutralised) still carries Amplify’s Fn::If default', () => {
      for (const [model, props] of Object.entries(baseline.tables)) {
        expect(props.pointInTimeRecoverySpecification, model).toHaveProperty('Fn::If')
      }
    })
  })

  describe('b. existing-site upgrade is in place', () => {
    it('adds/removes/renames no resource in any stack', () => {
      expect(current.inventory).toEqual(baseline.inventory)
      expect(Object.keys(current.inventory).some((p) => p.includes('data'))).toBe(true)
    })

    it('changes nothing on any table except pointInTimeRecoverySpecification', () => {
      expect(Object.keys(current.tables).sort()).toEqual(Object.keys(baseline.tables).sort())
      for (const model of Object.keys(current.tables)) {
        expect(withoutPitr(current.tables[model]), model).toEqual(
          withoutPitr(baseline.tables[model])
        )
      }
      // Spot-check that the compared props are the meaningful ones.
      const post = current.tables['Post']
      for (const key of ['tableName', 'keySchema', 'attributeDefinitions', 'streamSpecification']) {
        expect(post, key).toHaveProperty(key)
      }
    })

    describe('Amplify table-manager handler behaviour (real module)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let handler: any
      beforeAll(() => {
        if (!existsSync(TABLE_MANAGER_HANDLER)) {
          throw new Error(
            `Amplify table-manager handler not found at ${TABLE_MANAGER_HANDLER}. ` +
              'The @aws-amplify/graphql-api-construct layout changed — update this path ' +
              'and re-verify that PITR is still applied in place via UpdateContinuousBackups.'
          )
        }
        handler = createRequire(TABLE_MANAGER_HANDLER)(TABLE_MANAGER_HANDLER)
        expect(typeof handler.getPointInTimeRecoveryUpdate).toBe('function')
      })

      const status = (s: 'ENABLED' | 'DISABLED') => ({
        PointInTimeRecoveryDescription: { PointInTimeRecoveryStatus: s },
      })

      it('enables PITR on an existing table that has it off', () => {
        for (const [model, props] of Object.entries(current.tables)) {
          expect(
            handler.getPointInTimeRecoveryUpdate(status('DISABLED'), props),
            model
          ).toEqual({
            TableName: props.tableName,
            PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
          })
        }
      })

      it('documents the pre-change bug: baseline props disable manually-enabled PITR', () => {
        // The Fn::If default resolves to AWS::NoValue at deploy time,
        // i.e. the handler sees no spec at all.
        const props = withoutPitr(baseline.tables['Post'])
        expect(handler.getPointInTimeRecoveryUpdate(status('ENABLED'), props)).toEqual({
          TableName: props.tableName,
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: false },
        })
      })

      it('is a no-op once PITR is on', () => {
        for (const [model, props] of Object.entries(current.tables)) {
          expect(handler.getPointInTimeRecoveryUpdate(status('ENABLED'), props), model).toBe(
            undefined
          )
        }
      })

      it('keeps a recovery period configured earlier on an already-enabled table', () => {
        // A table enabled by hand with a shorter window (1–35 days) gets
        // no UpdateContinuousBackups call, so its RecoveryPeriodInDays is
        // left as-is — RUNBOOK documents this instead of "always 35 days".
        const existing = {
          PointInTimeRecoveryDescription: {
            PointInTimeRecoveryStatus: 'ENABLED',
            RecoveryPeriodInDays: 7,
          },
        }
        for (const [model, props] of Object.entries(current.tables)) {
          expect(handler.getPointInTimeRecoveryUpdate(existing, props), model).toBe(undefined)
        }
      })

      it('newly enables without a recovery period (DynamoDB default 35 days)', () => {
        const update = handler.getPointInTimeRecoveryUpdate(
          status('DISABLED'),
          current.tables['Post']
        )
        expect(update.PointInTimeRecoverySpecification).not.toHaveProperty('RecoveryPeriodInDays')
      })
    })
  })

  describe('c. customizations after defineAmplessBackend still win', () => {
    let customized: Synthesized
    beforeAll(() => {
      // Same shape as amplify/backend.custom.ts' customizeBackend(backend).
      customized = synthAmpless((backend) => {
        backend.data.resources.cfnResources.amplifyDynamoDbTables[
          'KvStore'
        ].pointInTimeRecoveryEnabled = false
      })
    }, 300_000)

    it('opts the chosen table out and leaves the rest on', () => {
      expect(customized.tables['KvStore'].pointInTimeRecoverySpecification).toEqual({
        pointInTimeRecoveryEnabled: false,
      })
      for (const [model, props] of Object.entries(customized.tables)) {
        if (model === 'KvStore') continue
        expect(props.pointInTimeRecoverySpecification, model).toEqual(PITR_ON)
      }
    })

    it('keeps the existing stream overrides', () => {
      const stream = { streamViewType: 'NEW_AND_OLD_IMAGES' }
      for (const s of [baseline, current, customized]) {
        expect(s.tables['Post'].streamSpecification).toEqual(stream)
        expect(s.tables['KvStore'].streamSpecification).toEqual(stream)
      }
    })

    it('leaves KvStore / PostHistory without a TTL spec (TTL is opt-in, #399)', () => {
      // backend.ttl.test.ts covers TTL in full; this only guards that the
      // PITR change and its opt-out don't introduce one either way.
      for (const model of ['KvStore', 'PostHistory']) {
        for (const s of [baseline, current, customized]) {
          expect(s.tables[model].timeToLiveSpecification, model).toBe(undefined)
        }
      }
    })
  })
})

// The template RUNBOOKs describe the behaviour verified above to site
// operators. Guard the points an earlier draft got wrong, in both
// languages: the recovery window is not always 35 days (an existing
// period is kept), the restorable range must be checked per table, and
// copy-back is a selective item repair rather than a site-wide rollback.
// `.changeset/config.json` sets `changelog: false`, so the RUNBOOKs must
// not send readers to a package CHANGELOG.
describe('template RUNBOOK PITR section', () => {
  const sharedDir = join(here, '../../../templates/_shared')
  const section = (file: string) => {
    const text = readFileSync(join(sharedDir, file), 'utf8')
    const start = text.search(/^### .*(point-in-time recovery|ポイントインタイムリカバリ)/m)
    expect(start, `${file}: PITR section heading`).toBeGreaterThanOrEqual(0)
    const end = text.indexOf('\n### ', start + 1)
    return text.slice(start, end === -1 ? undefined : end)
  }

  for (const file of ['RUNBOOK.md', 'RUNBOOK.ja.md']) {
    it(`${file} documents the restorable range, preserved periods and copy-back risks`, () => {
      const s = section(file)
      expect(s).not.toMatch(/CHANGELOG/)
      for (const needle of [
        'describe-continuous-backups',
        'EarliestRestorableDateTime',
        'LatestRestorableDateTime',
        'RecoveryPeriodInDays',
        'attribute_not_exists',
        'restore-table-to-point-in-time',
        'pointInTimeRecoveryEnabled = false',
      ]) {
        expect(s, needle).toContain(needle)
      }
    })
  }
})
