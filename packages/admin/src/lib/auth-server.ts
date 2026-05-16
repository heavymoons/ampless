import { cookies } from 'next/headers'
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth/server'
import type { AmplifyServer } from './amplify-server.js'

export interface ServerSession {
  userId: string
  email: string
  groups: string[]
}

/**
 * Build server-session helpers bound to an Amplify server runner.
 * Returned as plain functions so consumers can destructure and pass
 * around easily.
 */
export function createAuthServer(server: AmplifyServer) {
  const { runWithAmplifyServerContext } = server

  async function getServerSession(): Promise<ServerSession | null> {
    try {
      const session = await runWithAmplifyServerContext({
        nextServerContext: { cookies },
        operation: async (ctx) => {
          const authSession = await fetchAuthSession(ctx)
          const user = await getCurrentUser(ctx)
          const payload = authSession.tokens?.accessToken.payload
          const groups = (payload?.['cognito:groups'] as string[] | undefined) ?? []
          return {
            userId: user.userId,
            email: (user.signInDetails?.loginId as string) ?? '',
            groups,
          }
        },
      })
      return session
    } catch {
      return null
    }
  }

  function isAdmin(session: ServerSession | null): boolean {
    return !!session && session.groups.includes('ampless-admin')
  }

  function isEditor(session: ServerSession | null): boolean {
    return (
      !!session &&
      (session.groups.includes('ampless-admin') || session.groups.includes('ampless-editor'))
    )
  }

  return { getServerSession, isAdmin, isEditor }
}

export type AuthServer = ReturnType<typeof createAuthServer>
