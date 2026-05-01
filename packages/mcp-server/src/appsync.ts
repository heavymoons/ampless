import type { CognitoAuth } from './auth.js'

export interface GraphqlError {
  message: string
  errorType?: string
  path?: (string | number)[]
}

export class GraphqlClient {
  constructor(
    private readonly endpoint: string,
    private readonly auth: CognitoAuth
  ) {}

  async query<T>(operation: string, variables: Record<string, unknown> = {}): Promise<T> {
    const idToken = await this.auth.getIdToken()
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: idToken,
      },
      body: JSON.stringify({ query: operation, variables }),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`AppSync ${response.status}: ${text || response.statusText}`)
    }

    const json = (await response.json()) as { data?: T; errors?: GraphqlError[] }
    if (json.errors && json.errors.length > 0) {
      const msg = json.errors.map((e) => e.message).join('; ')
      throw new Error(`AppSync GraphQL error: ${msg}`)
    }
    if (!json.data) {
      throw new Error('AppSync returned an empty response')
    }
    return json.data
  }
}
