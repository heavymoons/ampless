/**
 * Cognito SRP sign-in for the MCP HTTP route's service user.
 *
 * The route runs server-side and needs a Cognito id token to call
 * AppSync (the schema is configured with `defaultAuthorizationMode:
 * 'userPool'`). Rather than thread per-MCP-token Cognito identities
 * through the system, we use one dedicated Cognito user that lives in
 * the `ampless-admin` group. Per-token role checks happen in the HTTP
 * route _before_ this id token is ever used (so an `editor`-scoped
 * MCP token can't reach admin-only mutations even though the underlying
 * Cognito identity could).
 *
 * Credentials are read from environment variables at cold start:
 *
 *   - `AMPLESS_MCP_SERVICE_EMAIL`
 *   - `AMPLESS_MCP_SERVICE_PASSWORD`
 *
 * Set them via Amplify Hosting's environment-variables UI. Missing
 * vars surface as a clear error at first MCP request instead of a
 * Cognito API error.
 *
 * This is a slimmer copy of `packages/mcp-server/src/auth.ts` —
 * duplicated rather than imported because the CLI auth class expects
 * a `ResolvedConfig` shape that ties it to the stdio path.
 */

import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoRefreshToken,
} from 'amazon-cognito-identity-js'
import type { AmplessOutputs } from '@ampless/runtime'

// Refresh tokens this many seconds before expiry. AppSync rejects
// expired tokens; the buffer covers in-flight requests that started
// just before the refresh threshold.
const REFRESH_BUFFER_SECONDS = 5 * 60

// amazon-cognito-identity-js touches `globalThis.navigator?.userAgent`
// on some code paths. Lambda's Node runtime has no `navigator` by
// default, so install a minimal stub.
const globals = globalThis as unknown as { navigator?: { userAgent: string } }
if (!globals.navigator) {
  globals.navigator = { userAgent: 'ampless-mcp-http' }
}

interface Session {
  idToken: string
  refreshToken: string
  expiresAt: number
}

interface RawCognitoResult {
  getIdToken(): { getJwtToken(): string; getExpiration(): number }
  getAccessToken(): { getJwtToken(): string }
  getRefreshToken(): { getToken(): string }
}

function toSession(result: RawCognitoResult): Session {
  return {
    idToken: result.getIdToken().getJwtToken(),
    refreshToken: result.getRefreshToken().getToken(),
    expiresAt: result.getIdToken().getExpiration(),
  }
}

/**
 * Module-scoped singleton. Caches the signed-in service user's id
 * token between Lambda invocations on the same warm container —
 * sign-in is a few hundred milliseconds, refresh is faster, and we
 * don't want to pay that on every MCP request.
 */
export class McpServiceAuth {
  private pool: CognitoUserPool | null = null
  private session: Session | null = null
  private refreshPromise: Promise<Session> | null = null

  constructor(private readonly outputs: AmplessOutputs) {}

  private getPool(): CognitoUserPool {
    if (this.pool) return this.pool
    // `AmplessOutputs.auth` is untyped (index signature) — the file
    // ships from Amplify with a stable nested shape; cast through to
    // grab the two fields the SDK needs.
    const auth = (this.outputs as { auth?: { user_pool_id?: string; user_pool_client_id?: string } })
      .auth
    if (!auth?.user_pool_id || !auth?.user_pool_client_id) {
      throw new Error(
        '[mcp] amplify_outputs.json is missing the auth block. Deploy the auth resource first.'
      )
    }
    this.pool = new CognitoUserPool({
      UserPoolId: auth.user_pool_id,
      ClientId: auth.user_pool_client_id,
    })
    return this.pool
  }

  private readEnvCreds(): { email: string; password: string } {
    const email = process.env.AMPLESS_MCP_SERVICE_EMAIL
    const password = process.env.AMPLESS_MCP_SERVICE_PASSWORD
    if (!email || !password) {
      throw new Error(
        '[mcp] AMPLESS_MCP_SERVICE_EMAIL / AMPLESS_MCP_SERVICE_PASSWORD env vars are required. ' +
          'Create a dedicated Cognito user in the `ampless-admin` group (e.g. via /admin/users) ' +
          'and set its credentials as Amplify Hosting environment variables.'
      )
    }
    return { email, password }
  }

  private async signIn(): Promise<Session> {
    const { email, password } = this.readEnvCreds()
    const user = new CognitoUser({ Username: email, Pool: this.getPool() })
    const auth = new AuthenticationDetails({ Username: email, Password: password })
    const session = await new Promise<Session>((resolveOk, reject) => {
      user.authenticateUser(auth, {
        onSuccess: (result) => resolveOk(toSession(result)),
        onFailure: (err) => reject(err),
        newPasswordRequired: () =>
          reject(
            new Error(
              '[mcp] Cognito returned NEW_PASSWORD_REQUIRED for the service user. ' +
                'Sign in to /admin/login once with the service-user creds to set a permanent password.'
            )
          ),
      })
    })
    this.session = session
    return session
  }

  /**
   * Returns a valid id token for the service user, signing in or
   * refreshing as needed. Concurrent callers share the same in-flight
   * refresh via `refreshPromise` so we don't fan out duplicate
   * sign-ins on cold-start bursts.
   */
  async getIdToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    if (!this.session) {
      const s = await this.signIn()
      return s.idToken
    }
    if (this.session.expiresAt - now > REFRESH_BUFFER_SECONDS) {
      return this.session.idToken
    }
    const fresh = await this.refresh()
    return fresh.idToken
  }

  private async refresh(): Promise<Session> {
    if (this.refreshPromise) return this.refreshPromise
    if (!this.session) return this.signIn()

    const refreshToken = new CognitoRefreshToken({ RefreshToken: this.session.refreshToken })
    const { email } = this.readEnvCreds()
    const user = new CognitoUser({ Username: email, Pool: this.getPool() })

    this.refreshPromise = new Promise<Session>((resolveOk, reject) => {
      user.refreshSession(refreshToken, (err, result) => {
        if (err || !result) {
          // Refresh tokens expire after their configured TTL (Cognito
          // default 30 days). Fall back transparently.
          this.session = null
          this.signIn().then(resolveOk, reject)
          return
        }
        const session = toSession(result as RawCognitoResult)
        this.session = session
        resolveOk(session)
      })
    }).finally(() => {
      this.refreshPromise = null
    })

    return this.refreshPromise
  }
}

// Per-process cache so the SSR Lambda's warm container reuses sessions
// across HTTP requests. A second `McpServiceAuth` instance for a
// different `AmplessOutputs` would just defeat the cache, which is
// fine — the lookup is keyed by reference.
const cache = new WeakMap<AmplessOutputs, McpServiceAuth>()

export function getMcpServiceAuth(outputs: AmplessOutputs): McpServiceAuth {
  const existing = cache.get(outputs)
  if (existing) return existing
  const fresh = new McpServiceAuth(outputs)
  cache.set(outputs, fresh)
  return fresh
}
