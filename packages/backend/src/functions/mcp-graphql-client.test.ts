import { afterEach, describe, expect, it, vi } from 'vitest'

// No real credentials or signing in unit tests: the signer passes the
// request through, and fetch is stubbed per test.
vi.mock('@aws-sdk/credential-provider-node', () => ({ defaultProvider: () => async () => ({}) }))
vi.mock('@smithy/signature-v4', () => ({
  SignatureV4: class {
    async sign(req: unknown) {
      return req
    }
  },
}))

const { createMcpGraphqlClient } = await import('./mcp-graphql-client.js')

function stubFetch(json: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(json), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const client = () =>
  createMcpGraphqlClient({ endpoint: 'https://example.appsync-api.us-east-1.amazonaws.com/graphql', region: 'us-east-1' })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createMcpGraphqlClient', () => {
  it('resolves data on success', async () => {
    stubFetch({ data: { getPost: { postId: 'p1' } } })
    await expect(client().query('query { getPost }')).resolves.toEqual({ getPost: { postId: 'p1' } })
  })

  it('throws with the same message and attaches the GraphQL errors (errorType included)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const errors = [
      { message: 'The conditional request failed', errorType: 'DynamoDB:ConditionalCheckFailedException', path: ['updatePost'] },
    ]
    stubFetch({ data: { updatePost: null }, errors })

    const err = await client()
      .query('mutation { updatePost }')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('AppSync GraphQL error: The conditional request failed')
    expect((err as { errors?: unknown }).errors).toEqual(errors)
  })
})
