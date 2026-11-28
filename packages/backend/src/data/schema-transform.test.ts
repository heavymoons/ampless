// Runs ampless's schema through the REAL `@aws-amplify/data-schema`
// transformer (re-exported as `a` by `@aws-amplify/backend`) and checks
// the GraphQL SDL it produces for the opt-in conditional update mutation.
// The proxy builder in index.test.ts only records calls; this proves the
// builder chain is accepted and yields the intended field signature.
import { describe, expect, it } from 'vitest'
import { a, defineFunction } from '@aws-amplify/backend'
import { amplessSchemaModels, amplessSchemaAuthorization } from './index.js'

function sdl(opts: Parameters<typeof amplessSchemaModels>[1]): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schema = (a as any).schema({ ...amplessSchemaModels(a, opts) })
  return schema.transform().schema as string
}

describe('schema transform', () => {
  it('omits amplessUpdatePostIfUnchanged without an explicit resolver path', () => {
    expect(sdl({})).not.toContain('amplessUpdatePostIfUnchanged')
  })

  it('declares amplessUpdatePostIfUnchanged(postId: ID!, patch: String!, expected: String!): Post with group auth', () => {
    const out = sdl({ resolverPaths: { updatePostIfUnchanged: '/abs/update-post-if-unchanged.js' } })
    const line = out.split('\n').find((l) => l.includes('amplessUpdatePostIfUnchanged'))
    expect(line).toBeDefined()
    expect(line).toMatch(/amplessUpdatePostIfUnchanged\(postId: ID!, patch: String!, expected: String!\): Post\b/)
    expect(line).toMatch(/@aws_cognito_user_pools\(cognito_groups: \["ampless-admin", "ampless-editor"\]\)/)
  })

  // What this can and cannot show about the MCP Lambda's access: the
  // schema-level resource grant is emitted as `functionSchemaAccess`
  // (query + mutate), exactly as for the stock Post operations, and the
  // SDL directive on the op itself is Cognito-only. Whether the Amplify
  // construct turns that grant into AppSync IAM access for THIS custom
  // mutation is decided downstream at deploy time — not verified offline.
  // If it does not, the MCP call fails "Unauthorized" and nothing is
  // written (fail closed).
  it('the MCP resource grant stays schema-level (functionSchemaAccess), the op SDL is Cognito-groups only', () => {
    const fn = defineFunction({ name: 'mcp', entry: './index.ts' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schema = (a as any)
      .schema({ ...amplessSchemaModels(a, { resolverPaths: { updatePostIfUnchanged: '/x.js' } }) })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .authorization((allow: any) => amplessSchemaAuthorization(allow, { mcpHandlerFunction: fn }))
    const t = schema.transform()
    const access = t.functionSchemaAccess as Array<{ actions: string[]; resourceProvider: unknown }>
    expect(access).toHaveLength(1)
    expect(access[0]!.actions).toEqual(['query', 'mutate'])
    expect(access[0]!.resourceProvider).toBe(fn)
    const line = (t.schema as string).split('\n').find((l) => l.includes('amplessUpdatePostIfUnchanged'))
    expect(line).not.toContain('@aws_iam')
  })
})
