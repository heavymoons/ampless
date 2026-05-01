import { cookies } from 'next/headers'
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth/server'
import { runWithAmplifyServerContext } from './amplify-server'

export interface ServerSession {
  userId: string
  email: string
  groups: string[]
}

export async function getServerSession(): Promise<ServerSession | null> {
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

export function isAdmin(session: ServerSession | null): boolean {
  return !!session && session.groups.includes('ampless-admin')
}

export function isEditor(session: ServerSession | null): boolean {
  return (
    !!session &&
    (session.groups.includes('ampless-admin') || session.groups.includes('ampless-editor'))
  )
}
