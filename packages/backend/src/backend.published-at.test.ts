import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Stack, type AssetStaging } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import type { CfnResolver } from 'aws-cdk-lib/aws-appsync'
import { Asset } from 'aws-cdk-lib/aws-s3-assets'
import { insertPublishedAtNormalizer, type AmplessBackend } from './backend.js'
import {
  PUBLISHED_AT_NORMALIZER_REQUEST_TEMPLATES,
  PUBLISHED_AT_NORMALIZER_RESPONSE_TEMPLATE,
} from './data/post-published-at-normalizer.js'
import {
  TABLE_MANAGER_HANDLER,
  setBackendNamespace,
  synthAmpless,
  type Synthesized,
} from './__fixtures__/synth.js'

// Write-time publishedAt normalization (#406) — verified against REAL
// synthesized CloudFormation (see __fixtures__/synth.ts): the normalizer
// function sits in the generated createPost / updatePost pipelines right
// before the data function, the Post table gains the byStatusSorted GSI,
// and the generated data templates still read `$ctx.stash.transformedArgs`
// (which is how the normalizer's output reaches DynamoDB).

setBackendNamespace('amplesspublishedattest')

// Lets one test break the generated pipeline between Amplify's
// defineBackend and the ampless wiring that runs right after it.
const hooks = vi.hoisted(() => ({
  afterDefineBackend: undefined as undefined | ((backend: AmplessBackend) => void),
}))
vi.mock('@aws-amplify/backend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-amplify/backend')>()
  return {
    ...actual,
    defineBackend: ((...args: Parameters<typeof actual.defineBackend>) => {
      const backend = actual.defineBackend(...args)
      hooks.afterDefineBackend?.(backend)
      return backend
    }) as typeof actual.defineBackend,
  }
})

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(
  readFileSync(join(here, 'data/post-published-at-normalizer.fixture.json'), 'utf8')
) as { generatedTemplateSha256: Record<string, string> }

const OPS = ['create', 'update'] as const
const cap = (op: string) => op[0].toUpperCase() + op.slice(1)
const normalizerId = (op: string) => `Ampless${cap(op)}PostPublishedAtNormalizer`
const TRANSFORMED_ARGS_LINE =
  '#set( $args = $util.defaultIfNull($ctx.stash.transformedArgs, $ctx.args) )'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Resources = Record<string, any>
// GetAtt [logicalId, 'FunctionId'] → logicalId
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fnLogicalIds = (resolver: any): string[] =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolver.Properties.PipelineConfig.Functions.map((f: any) => {
    expect(f['Fn::GetAtt']?.[1]).toBe('FunctionId')
    return f['Fn::GetAtt'][0] as string
  })

describe('defineAmplessBackend — publishedAt normalizer and byStatusSorted', () => {
  let current: Synthesized
  let postStack: Stack
  let postResources: Resources

  beforeAll(() => {
    current = synthAmpless()
    const resolver = current.backend.data.resources.cfnResources.cfnResolvers['Mutation.createPost']
    postStack = Stack.of(resolver)
    postResources = Template.fromStack(postStack).toJSON().Resources as Resources
  }, 300_000)

  afterEach(() => {
    hooks.afterDefineBackend = undefined
  })

  const resolverResource = (op: string) => {
    const r = current.backend.data.resources.cfnResources.cfnResolvers[`Mutation.${op}Post`]
    return postResources[postStack.resolve(r.logicalId) as string]
  }

  describe('pipeline wiring', () => {
    it.each(OPS)('%sPost: exactly one normalizer, right before the data function', (op) => {
      const ids = fnLogicalIds(resolverResource(op))
      const names = ids.map((id) => postResources[id].Properties.Name as string)
      expect(ids.filter((id) => id === normalizerId(op))).toHaveLength(1)
      const at = ids.indexOf(normalizerId(op))
      expect(names[at + 1]).toBe(`Mutation${cap(op)}PostDataResolverFn`)
      expect(at + 1).toBe(names.length - 1)
      expect(names[at - 1]).toMatch(new RegExp(`^Mutation${op}PostpostAuth\\d+Function$`))
      expect(names.slice(0, at)).toEqual([
        expect.stringMatching(new RegExp(`^Mutation${op}Postinit\\d+Function$`)),
        expect.stringMatching(new RegExp(`^Mutation${op}PostpreAuth\\d+Function$`)),
        expect.stringMatching(new RegExp(`^Mutation${op}Postauth\\d+Function$`)),
        expect.stringMatching(new RegExp(`^Mutation${op}PostpostAuth\\d+Function$`)),
      ])
    })

    it.each(OPS)('%sPost: the function carries the exported templates on NONE_DS', (op) => {
      const fn = postResources[normalizerId(op)]
      expect(fn.Type).toBe('AWS::AppSync::FunctionConfiguration')
      expect(fn.Properties.RequestMappingTemplate).toBe(
        PUBLISHED_AT_NORMALIZER_REQUEST_TEMPLATES[op]
      )
      expect(fn.Properties.ResponseMappingTemplate).toBe(PUBLISHED_AT_NORMALIZER_RESPONSE_TEMPLATE)
      expect(fn.Properties.FunctionVersion).toBe('2018-05-29')
      // Same NONE data source (and API) as Amplify's own init function.
      const init = postResources[fnLogicalIds(resolverResource(op))[0]]
      expect(fn.Properties.DataSourceName).toEqual(init.Properties.DataSourceName)
      expect(fn.Properties.ApiId).toEqual(init.Properties.ApiId)
    })

    it('adds the two functions and touches no other resolver', () => {
      const normalizers = Object.entries(current.inventory).flatMap(([path, resources]) =>
        Object.entries(resources)
          .filter(([id]) => id.includes('PublishedAtNormalizer'))
          .map(([id, type]) => [path, id, type])
      )
      expect(normalizers).toEqual([
        [postStack.node.path, normalizerId('create'), 'AWS::AppSync::FunctionConfiguration'],
        [postStack.node.path, normalizerId('update'), 'AWS::AppSync::FunctionConfiguration'],
      ])
      const createOrUpdate = OPS.map((op) => resolverResource(op))
      const others = Object.values(postResources).filter(
        (r) => r.Type === 'AWS::AppSync::Resolver' && !createOrUpdate.includes(r)
      )
      expect(others.length).toBeGreaterThan(5) // get/list/delete/subscriptions/byStatus...
      for (const r of others) {
        expect(JSON.stringify(r.Properties)).not.toContain('PublishedAtNormalizer')
      }
    })

    it('is idempotent on the same backend', () => {
      const resolver = current.backend.data.resources.cfnResources.cfnResolvers[
        'Mutation.createPost'
      ] as CfnResolver
      const before = [...(resolver.pipelineConfig as CfnResolver.PipelineConfigProperty).functions!]
      insertPublishedAtNormalizer(current.backend, 'create')
      expect((resolver.pipelineConfig as CfnResolver.PipelineConfigProperty).functions).toEqual(
        before
      )
    })
  })

  describe('generated templates the normalizer relies on', () => {
    // Every createPost / updatePost function template asset in the Post
    // stack, keyed by file name.
    const generatedTemplates = () => {
      const out: Record<string, { path: string; text: string }> = {}
      for (const c of postStack.node.findAll()) {
        if (!(c instanceof Asset)) continue
        const m = /^Templateresolvers--(Mutation\.(create|update)Post\..*vtl)$/.exec(c.node.id)
        if (!m) continue
        const path = (c.node.findChild('Stage') as AssetStaging).sourcePath
        expect(basename(path)).toBe(m[1])
        out[m[1]] = { path, text: readFileSync(path, 'utf8') }
      }
      return out
    }

    it.each(OPS)('%sPost data template reads $ctx.stash.transformedArgs first', (op) => {
      const t = generatedTemplates()[`Mutation.${op}Post.req.vtl`]
      expect(t, 'data template asset').toBeDefined()
      const lines = t.text.split('\n')
      expect(lines.slice(0, 3)).toContain(TRANSFORMED_ARGS_LINE)
      // Everything else goes through $args — a direct $ctx.args read
      // would bypass the normalizer.
      expect(lines.filter((l) => l.includes('$ctx.args'))).toEqual([TRANSFORMED_ARGS_LINE])
    })

    it('match the templates the evaluate script chained (re-run it when Amplify changes them)', () => {
      const templates = generatedTemplates()
      const hashes = Object.fromEntries(
        Object.entries(templates).map(([name, t]) => [
          name,
          createHash('sha256').update(t.text).digest('hex'),
        ])
      )
      const dir = dirname(Object.values(templates)[0].path)
      expect(
        hashes,
        `generated templates changed: re-run scripts/evaluate-published-at-normalizer.mjs --resolvers ${dir}`
      ).toEqual(fixture.generatedTemplateSha256)
    })

    it.each(OPS)('%sPost resolver stashes what the evaluate script seeds', (op) => {
      const r = current.backend.data.resources.cfnResources.cfnResolvers[`Mutation.${op}Post`]
      expect(r.requestMappingTemplate).toContain('$util.qr($ctx.stash.put("conditions", []))')
      expect(r.requestMappingTemplate).toContain('$util.qr($ctx.stash.put("metadata", {}))')
    })
  })

  describe('Post table: byStatusSorted GSI', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gsis = () => current.tables['Post'].globalSecondaryIndexes as any[]
    const gsi = (name: string) => gsis().find((g) => g.indexName === name)

    it('adds byStatusSorted (status / publishedAtSortKey) with the byStatus projection', () => {
      expect(
        gsis()
          .map((g) => g.indexName)
          .sort()
      ).toEqual(['bySlug', 'byStatus', 'byStatusSorted'])
      expect(gsi('byStatusSorted').keySchema).toEqual([
        { attributeName: 'status', keyType: 'HASH' },
        { attributeName: 'publishedAtSortKey', keyType: 'RANGE' },
      ])
      expect(gsi('byStatusSorted').projection).toEqual(gsi('byStatus').projection)
      expect(current.tables['Post'].attributeDefinitions).toContainEqual({
        attributeName: 'publishedAtSortKey',
        attributeType: 'S',
      })
    })

    it('leaves byStatus and bySlug unchanged', () => {
      expect(gsi('byStatus').keySchema).toEqual([
        { attributeName: 'status', keyType: 'HASH' },
        { attributeName: 'publishedAt', keyType: 'RANGE' },
      ])
      expect(gsi('byStatus').projection).toEqual({ projectionType: 'ALL' })
      expect(gsi('bySlug').keySchema).toEqual([{ attributeName: 'slug', keyType: 'HASH' }])
      expect(gsi('bySlug').projection).toEqual({ projectionType: 'ALL' })
      const { provisionedThroughput, ...rest } = gsi('byStatusSorted')
      expect(provisionedThroughput).toEqual(gsi('byStatus').provisionedThroughput)
      expect(Object.keys(rest).sort()).toEqual(['indexName', 'keySchema', 'projection'])
    })

    it('adds the GSI in place in a sandbox instead of replacing (emptying) the table', () => {
      const post = current.tables['Post']
      // The fixture synthesizes a sandbox: Amplify's aspect is active.
      expect(post.replaceTableUponGsiUpdate).toBe(true)
      expect(post.allowDestructiveGraphqlSchemaUpdates).toBe(false)
      // Other tables keep Amplify's default (no other index changes here).
      expect(current.tables['Page'].allowDestructiveGraphqlSchemaUpdates).toBe(true)

      // What the real table-manager handler sees: CloudFormation passes
      // custom-resource properties as strings, which it converts back.
      // It replaces the table on a GSI change only when both flags are
      // true (amplify-table-manager-handler.js onEventHandler).
      const handler = createRequire(TABLE_MANAGER_HANDLER)(TABLE_MANAGER_HANDLER)
      const asStrings = JSON.parse(
        JSON.stringify(post, (_k, v) => (typeof v === 'boolean' ? String(v) : v))
      )
      const tableDef = handler.extractOldTableInputFromEvent({ OldResourceProperties: asStrings })
      expect(tableDef.replaceTableUponGsiUpdate).toBe(true)
      expect(tableDef.allowDestructiveGraphqlSchemaUpdates).toBe(false)
    })
  })

  describe('fails the synth when the generated pipeline is not what it expects', () => {
    const cfnResolvers = (backend: AmplessBackend) =>
      backend.data.resources.cfnResources.cfnResolvers as Record<string, CfnResolver>

    it('throws when the data function is missing from the createPost pipeline', () => {
      hooks.afterDefineBackend = (backend) => {
        const r = cfnResolvers(backend)['Mutation.createPost']
        const pc = r.pipelineConfig as CfnResolver.PipelineConfigProperty
        r.pipelineConfig = { functions: pc.functions!.slice(0, -1) }
      }
      expect(() => synthAmpless()).toThrow(
        'data function MutationCreatePostDataResolverFn is not in the Mutation.createPost pipeline'
      )
    })

    it('throws when updatePost is not a pipeline resolver', () => {
      hooks.afterDefineBackend = (backend) => {
        cfnResolvers(backend)['Mutation.updatePost'].pipelineConfig = undefined
      }
      expect(() => synthAmpless()).toThrow(
        'Mutation.updatePost is not a pipeline resolver with a functions list'
      )
    })

    it('throws when the resolver is missing', () => {
      hooks.afterDefineBackend = (backend) => {
        delete cfnResolvers(backend)['Mutation.updatePost']
      }
      expect(() => synthAmpless()).toThrow('resolver Mutation.updatePost not found')
    })
  })
})
