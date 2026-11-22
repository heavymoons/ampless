// Test-only helpers shared by the real-synth backend tests
// (backend.pitr.test.ts, backend.ttl.test.ts): the full
// `defineAmplessBackend` (real defineAuth / defineData / defineStorage +
// the ampless schema) is synthesized and the AmplifyDynamoDBTable custom
// resources are read back from the nested-stack templates.
import { createRequire } from 'node:module'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, vi } from 'vitest'
import { CfnResource, Stack } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { defineAmplessBackend, type AmplessBackend } from '../backend.js'
import { makeFunctions } from './amplify/functions.js'
import { makeAuth } from './amplify/auth/resource.js'
import { makeData } from './amplify/data/resource.js'
import { makeStorage } from './amplify/storage/resource.js'

/**
 * Amplify's default stack reads the backend identifier from CDK context
 * (see @aws-amplify/backend lib/backend_identifier.js). `new App()` picks
 * up CDK_CONTEXT_JSON, so call this before any backend is constructed.
 */
export function setBackendNamespace(namespace: string): void {
  process.env.CDK_CONTEXT_JSON = JSON.stringify({
    'amplify-backend-namespace': namespace,
    'amplify-backend-name': 'sandbox',
    'amplify-backend-type': 'sandbox',
  })
}

export const TABLE_TYPE = 'Custom::AmplifyDynamoDBTable'
export const AMPLESS_MODELS = [
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

const backendDir = packageDirFrom(join(here, '../..'), '@aws-amplify/backend')
const backendDataDir = packageDirFrom(backendDir, '@aws-amplify/backend-data')
const dataConstructDir = packageDirFrom(backendDataDir, '@aws-amplify/data-construct')
const graphqlApiConstructDir = packageDirFrom(
  dataConstructDir,
  '@aws-amplify/graphql-api-construct'
)
const requireFromApiConstruct = createRequire(join(graphqlApiConstructDir, 'package.json'))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const { AmplifyDynamoDbTableWrapper } = requireFromApiConstruct('./lib/index.js') as any

export const TABLE_MANAGER_HANDLER = join(
  graphqlApiConstructDir,
  'node_modules/@aws-amplify/graphql-model-transformer/lib/resources/amplify-dynamodb-table/amplify-table-manager-lambda/amplify-table-manager-handler.js'
)

// ---------------------------------------------------------------------------
// Synth helpers
// ---------------------------------------------------------------------------

export interface Synthesized {
  backend: AmplessBackend
  /** model name → synthesized `Properties` of its AmplifyDynamoDBTable */
  tables: Record<string, Record<string, unknown>>
  /** stack node path → { logicalId: resource type } for every stack in the app */
  inventory: Record<string, Record<string, string>>
}

export function synthAmpless(customize?: (backend: AmplessBackend) => void): Synthesized {
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
    // Guard that the spy target in synthWithInertSetter is the class
    // Amplify really uses.
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

/**
 * Synthesize with one AmplifyDynamoDbTableWrapper setter neutralised —
 * i.e. as if no code path had ever assigned it. Used as the
 * "previous release" baseline.
 */
export function synthWithInertSetter(
  setter: 'pointInTimeRecoveryEnabled' | 'timeToLiveAttribute',
  customize?: (backend: AmplessBackend) => void
): Synthesized {
  const spy = vi
    .spyOn(AmplifyDynamoDbTableWrapper.prototype, setter, 'set')
    .mockImplementation(() => {})
  try {
    return synthAmpless(customize)
  } finally {
    spy.mockRestore()
  }
}
