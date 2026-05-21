import { Sha256 } from '@aws-crypto/sha256-js'
import { HttpRequest } from '@smithy/protocol-http'
import { SignatureV4 } from '@smithy/signature-v4'
import { defaultProvider } from '@aws-sdk/credential-provider-node'

import type { GraphqlClient } from '@ampless/mcp-server/tools'

/**
 * AppSync GraphQL client that authenticates with AWS Signature V4
 * (`AWS_IAM` auth mode). Used by the mcp-handler Lambda — the Lambda
 * has an IAM role with `appsync:GraphQL` permission scoped to specific
 * models via `allow.resource()` in the schema. SigV4 signing lets
 * AppSync verify the request came from that role without any Cognito
 * identity, shared API key, or user token.
 *
 * The signed request body is the standard AppSync GraphQL payload
 * (`{ query, variables }`); identical to what the Cognito-id-token
 * client in `packages/mcp-server/src/appsync.ts` sends. Only the
 * authentication header changes.
 *
 * Credentials come from the default provider chain (env vars in tests,
 * ECS / EC2 / Lambda instance role in production). The chain is
 * memoised by the SDK so we don't repeat metadata-service lookups on
 * every call.
 */
export interface McpGraphqlClientOpts {
  /** Full AppSync HTTPS URL (`https://xxx.appsync-api.{region}.amazonaws.com/graphql`). */
  endpoint: string
  /** AWS region (`us-east-1`, `ap-northeast-1`, ...). */
  region: string
}

interface AppSyncResponse<T> {
  data?: T
  errors?: Array<{ message: string; errorType?: string; path?: (string | number)[] }>
}

export function createMcpGraphqlClient(opts: McpGraphqlClientOpts): GraphqlClient {
  const url = new URL(opts.endpoint)
  const signer = new SignatureV4({
    service: 'appsync',
    region: opts.region,
    credentials: defaultProvider(),
    sha256: Sha256,
  })

  return {
    async query<T>(operation: string, variables: Record<string, unknown> = {}): Promise<T> {
      const body = JSON.stringify({ query: operation, variables })
      const request = new HttpRequest({
        method: 'POST',
        protocol: url.protocol,
        hostname: url.hostname,
        path: url.pathname,
        headers: {
          // `host` is required for SigV4 canonicalisation.
          host: url.hostname,
          'content-type': 'application/json',
        },
        body,
      })

      const signed = await signer.sign(request)

      const response = await fetch(opts.endpoint, {
        method: 'POST',
        headers: signed.headers as Record<string, string>,
        body,
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        // Log so CloudWatch captures the AppSync error shape; this is
        // the only place to see what AppSync rejected.
        console.error('[mcp-graphql-client] AppSync HTTP error', {
          status: response.status,
          body: text.slice(0, 1000),
        })
        throw new Error(`AppSync ${response.status}: ${text || response.statusText}`)
      }

      const json = (await response.json()) as AppSyncResponse<T>
      if (json.errors && json.errors.length > 0) {
        const msg = json.errors.map((e) => e.message).join('; ')
        console.error('[mcp-graphql-client] AppSync GraphQL errors', { errors: json.errors })
        throw new Error(`AppSync GraphQL error: ${msg}`)
      }
      if (!json.data) {
        throw new Error('AppSync returned an empty response')
      }
      return json.data
    },
  }
}
