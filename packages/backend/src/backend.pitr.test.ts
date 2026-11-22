import { createRequire } from 'node:module'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CfnResource, Stack } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { defineAmplessBackend, type AmplessBackend } from './backend.js'
import { makeFunctions } from './__fixtures__/amplify/functions.js'
import { makeAuth } from './__fixtures__/amplify/auth/resource.js'
import { makeData, CUSTOM_MODEL_NAME } from './__fixtures__/amplify/data/resource.js'
import { makeStorage } from './__fixtures__/amplify/storage/resource.js'

// DynamoDB point-in-time recovery (#395) — verified against REAL
// synthesized CloudFormation: the full `defineAmplessBackend` (real
// defineAuth / defineData / defineStorage + the ampless schema) is
// synthesized and the AmplifyDynamoDBTable custom resources are read
// back from the nested-stack templates.

// Amplify's default stack reads the backend identifier from CDK context
// (see @aws-amplify/backend lib/backend_identifier.js). `new App()` picks
// up CDK_CONTEXT_JSON, so set it before any backend is constructed.
process.env.CDK_CONTEXT_JSON = JSON.stringify({
  'amplify-backend-namespace': 'amplesspitrtest',
  'amplify-backend-name': 'sandbox',
  'amplify-backend-type': 'sandbox',
})

const TABLE_TYPE = 'Custom::AmplifyDynamoDBTable'
const PITR_ON = { pointInTimeRecoveryEnabled: true }
const AMPLESS_MODELS = [
  'Post',
  'Page',
  'Media',
  'Taxonomy',
  'PostTag',
  'KvStore',
  'McpToken',
  'PluginSecret',
  'PluginSecretIndicator',
  'PostHistory',
]

// ---------------------------------------------------------------------------
// Resolve Amplify internals from the copies @aws-amplify/backend actually
// loads (pnpm nests them; none is a direct dependency of this package).
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url))

function packageDirFrom(fromDir: string, pkg: string): string {
  const req = createRequire(join(fromDir, 'package.json'))
  const entry = realpathSync(req.resolve(pkg))
  let dir = dirname(entry)
  const isRoot = (d: string) =>
    existsSync(join(d, 'package.json')) && req(join(d, 'package.json')).name === pkg
  while (!isRoot(dir)) {
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`Could not locate package root of ${pkg} from ${entry}`)
    dir = parent
  }
  return dir
}

const backendDir = packageDirFrom(join(here, '..'), '@aws-amplify/backend')
const backendDataDir = packageDirFrom(backendDir, '@aws-amplify/backend-data')
const dataConstructDir = packageDirFrom(backendDataDir, '@aws-amplify/data-construct')
const graphqlApiConstructDir = packageDirFrom(dataConstructDir, '@aws-amplify/graphql-api-construct')
const requireFromApiConstruct = createRequire(join(graphqlApiConstructDir, 'package.json'))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { AmplifyDynamoDbTableWrapper } = requireFromApiConstruct('./lib/index.js') as any

const TABLE_MANAGER_HANDLER = join(
  graphqlApiConstructDir,
  'node_modules/@aws-amplify/graphql-model-transformer/lib/resources/amplify-dynamodb-table/amplify-table-manager-lambda/amplify-table-manager-handler.js'
)

// ---------------------------------------------------------------------------
// Synth helpers
// ---------------------------------------------------------------------------

interface Synthesized {
  backend: AmplessBackend
  /** model name → synthesized `Properties` of its AmplifyDynamoDBTable */
  tables: Record<string, Record<string, unknown>>
  /** stack node path → { logicalId: resource type } for every stack in the app */
  inventory: Record<string, Record<string, string>>
}

function synthAmpless(customize?: (backend: AmplessBackend) => void): Synthesized {
  const fns = makeFunctions()
  const backend = defineAmplessBackend({
    ...fns,
    auth: makeAuth(fns.postConfirmation),
    data: makeData(fns),
    storage: makeStorage(),
    pluginSecretEncryptionKey: 'dGVzdC1rZXk=',
  })
  customize?.(backend)

  const templates = new Map<Stack, Record<string, unknown>>()
  const templateOf = (stack: Stack) => {
    let t = templates.get(stack)
    if (!t) {
      t = Template.fromStack(stack).toJSON()
      templates.set(stack, t)
    }
    return t
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resourcesOf = (stack: Stack) => (templateOf(stack).Resources ?? {}) as Record<string, any>

  const tables: Synthesized['tables'] = {}
  const wrappers = backend.data.resources.cfnResources.amplifyDynamoDbTables as Record<
    string,
    unknown
  >
  for (const [model, wrapper] of Object.entries(wrappers)) {
    // Guard that the spy target below is the class Amplify really uses.
    expect(wrapper).toBeInstanceOf(AmplifyDynamoDbTableWrapper)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cfn = (wrapper as any).resource as CfnResource
    const stack = Stack.of(cfn)
    const resource = resourcesOf(stack)[stack.getLogicalId(cfn)]
    expect(resource?.Type).toBe(TABLE_TYPE)
    tables[model] = resource.Properties
  }

  const inventory: Synthesized['inventory'] = {}
  for (const stack of backend.stack.node.findAll().filter(Stack.isStack)) {
    inventory[stack.node.path] = Object.fromEntries(
      Object.entries(resourcesOf(stack)).map(([id, r]) => [id, r.Type as string])
    )
  }

  return { backend, tables, inventory }
}

/** The previous release: identical wiring, but the PITR setter is inert. */
function synthBaseline(): Synthesized {
  const spy = vi
    .spyOn(AmplifyDynamoDbTableWrapper.prototype, 'pointInTimeRecoveryEnabled', 'set')
    .mockImplementation(() => {})
  try {
    return synthAmpless()
  } finally {
    spy.mockRestore()
  }
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

    it('leaves the KvStore / PostHistory TTL output exactly as before', () => {
      // Compared against the baseline rather than a literal: the wrapper's
      // TTL setter is `timeToLiveAttribute`, so the existing
      // `timeToLiveSpecification = ...` assignments in backend.ts do not
      // reach the template today. That is out of scope here; this only
      // guards that the PITR change doesn't alter it either way.
      for (const model of ['KvStore', 'PostHistory']) {
        for (const s of [current, customized]) {
          expect(s.tables[model].timeToLiveSpecification, model).toEqual(
            baseline.tables[model].timeToLiveSpecification
          )
        }
      }
    })
  })
})
