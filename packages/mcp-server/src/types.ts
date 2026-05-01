// Internal types shared across mcp-server modules.
// Public types are re-exported from src/index.ts.

export interface AmplifyOutputs {
  auth: {
    user_pool_id: string
    user_pool_client_id: string
    aws_region: string
    identity_pool_id?: string
  }
  data: {
    url: string
    aws_region: string
    default_authorization_type?: string
    api_key?: string
  }
  storage?: {
    bucket_name: string
    aws_region: string
  }
}

export interface ResolvedConfig {
  outputs: AmplifyOutputs
  email: string
  password: string
  /** Site identifier passed to all queries that don't override it. */
  defaultSiteId: string
}

export interface AuthSession {
  idToken: string
  accessToken: string
  refreshToken: string
  /** Unix epoch seconds when the id token stops being valid. */
  expiresAt: number
}
