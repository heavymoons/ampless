import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoRefreshToken,
} from 'amazon-cognito-identity-js'
import type { ResolvedConfig, AuthSession } from './types.js'

// Refresh tokens this many seconds before the id token expires. AppSync
// rejects expired tokens, so we want a generous buffer for in-flight
// requests that started just before expiry.
const REFRESH_BUFFER_SECONDS = 5 * 60

// amazon-cognito-identity-js relies on `globalThis.navigator?.userAgent` in
// some code paths. Node 20 has no `navigator` global by default — provide a
// stub so SRP authentication works in a vanilla Node environment.
const globals = globalThis as unknown as { navigator?: { userAgent: string } }
if (!globals.navigator) {
  globals.navigator = { userAgent: 'ampless-mcp-server' }
}

export class CognitoAuth {
  private readonly pool: CognitoUserPool
  private session: AuthSession | null = null
  private refreshPromise: Promise<AuthSession> | null = null

  constructor(private readonly config: ResolvedConfig) {
    this.pool = new CognitoUserPool({
      UserPoolId: config.outputs.auth.user_pool_id,
      ClientId: config.outputs.auth.user_pool_client_id,
    })
  }

  /** Initial sign-in (SRP). Caches the session for subsequent calls. */
  async signIn(): Promise<AuthSession> {
    const user = new CognitoUser({ Username: this.config.email, Pool: this.pool })
    const auth = new AuthenticationDetails({
      Username: this.config.email,
      Password: this.config.password,
    })
    const session = await new Promise<AuthSession>((resolveOk, reject) => {
      user.authenticateUser(auth, {
        onSuccess: (result) => resolveOk(toSession(result)),
        onFailure: (err) => reject(err),
        newPasswordRequired: () =>
          reject(
            new Error(
              'Cognito returned NEW_PASSWORD_REQUIRED — sign in via the web UI once to set a permanent password.'
            )
          ),
      })
    })
    this.session = session
    return session
  }

  /** Returns a valid id token, signing in or refreshing as needed. */
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

  private async refresh(): Promise<AuthSession> {
    if (this.refreshPromise) return this.refreshPromise
    if (!this.session) return this.signIn()

    const refreshToken = new CognitoRefreshToken({
      RefreshToken: this.session.refreshToken,
    })
    const user = new CognitoUser({ Username: this.config.email, Pool: this.pool })

    this.refreshPromise = new Promise<AuthSession>((resolveOk, reject) => {
      user.refreshSession(refreshToken, (err, result) => {
        if (err || !result) {
          // Refresh tokens can expire (default 30 days); fall back to a
          // fresh sign-in transparently.
          this.session = null
          this.signIn().then(resolveOk, reject)
          return
        }
        const session = toSession(result)
        this.session = session
        resolveOk(session)
      })
    }).finally(() => {
      this.refreshPromise = null
    })

    return this.refreshPromise
  }
}

function toSession(result: {
  getIdToken(): { getJwtToken(): string; getExpiration(): number }
  getAccessToken(): { getJwtToken(): string }
  getRefreshToken(): { getToken(): string }
}): AuthSession {
  return {
    idToken: result.getIdToken().getJwtToken(),
    accessToken: result.getAccessToken().getJwtToken(),
    refreshToken: result.getRefreshToken().getToken(),
    expiresAt: result.getIdToken().getExpiration(),
  }
}
