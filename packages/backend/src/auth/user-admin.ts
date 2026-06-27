import type { Handler } from 'aws-lambda'
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminListGroupsForUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider'

// AppSync Lambda handler backing the `listAdminUsers` query and the
// `setAdminUserRole` mutation. One handler covers both ops because the
// IAM surface (Cognito Admin* actions on this user pool) is the same
// and AppSync sets `event.info.fieldName` per operation.
//
// Re-exported from the template's thin shell
// `amplify/functions/user-admin/handler.ts`; Amplify's esbuild bundles
// this module into the Lambda artifact.

const cognito = new CognitoIdentityProviderClient({})

// Cognito groups we map onto the admin UI's three-state role select.
// `none` removes the user from both groups (they keep `ampless-reader`-
// equivalent access — i.e. nothing in the admin UI).
const ADMIN_GROUP = 'ampless-admin'
const EDITOR_GROUP = 'ampless-editor'

type AdminRole = 'admin' | 'editor' | 'none'

interface AdminUserDto {
  userId: string
  email: string
  role: AdminRole
}

function requireUserPoolId(): string {
  const v = process.env.AMPLESS_USER_POOL_ID
  if (!v) {
    console.error('[user-admin] missing required env var AMPLESS_USER_POOL_ID')
    throw new Error('user-admin: missing required env var AMPLESS_USER_POOL_ID')
  }
  return v
}

function emailOf(user: UserType): string {
  const attr = user.Attributes?.find((a) => a.Name === 'email')
  return attr?.Value ?? ''
}

async function roleOf(userPoolId: string, username: string): Promise<AdminRole> {
  const { Groups } = await cognito.send(
    new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: username })
  )
  const names = (Groups ?? []).map((g) => g.GroupName)
  // admin wins over editor when somehow both are set.
  if (names.includes(ADMIN_GROUP)) return 'admin'
  if (names.includes(EDITOR_GROUP)) return 'editor'
  return 'none'
}

async function listAdminUsers(userPoolId: string): Promise<AdminUserDto[]> {
  const { Users } = await cognito.send(
    new ListUsersCommand({ UserPoolId: userPoolId, Limit: 60 })
  )
  const users = Users ?? []
  const out: AdminUserDto[] = []
  for (const u of users) {
    if (!u.Username) continue
    const role = await roleOf(userPoolId, u.Username)
    out.push({ userId: u.Username, email: emailOf(u), role })
  }
  return out
}

async function setAdminUserRole(
  userPoolId: string,
  userId: string,
  role: AdminRole
): Promise<AdminUserDto> {
  // Strip both admin/editor first so we never end up with a user in
  // two role groups simultaneously. RemoveUserFromGroup is a no-op
  // when the user isn't a member, so this is safe to call unconditionally.
  for (const group of [ADMIN_GROUP, EDITOR_GROUP]) {
    await cognito.send(
      new AdminRemoveUserFromGroupCommand({
        UserPoolId: userPoolId,
        Username: userId,
        GroupName: group,
      })
    )
  }
  if (role !== 'none') {
    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: userId,
        GroupName: role === 'admin' ? ADMIN_GROUP : EDITOR_GROUP,
      })
    )
  }
  // Fetch the user's email + freshly-computed role so the UI can
  // reconcile the row without a separate round-trip.
  const { Users } = await cognito.send(
    new ListUsersCommand({
      UserPoolId: userPoolId,
      Filter: `sub = "${userId}"`,
      Limit: 1,
    })
  )
  const user = Users?.[0]
  const email = user ? emailOf(user) : ''
  const finalRole = await roleOf(userPoolId, userId)
  return { userId, email, role: finalRole }
}

interface SetArgs {
  userId: string
  role: string
}

/**
 * Event shape that Amplify Gen 2 actually delivers to a Lambda data
 * source attached via `a.handler.function()`. The CDK generated
 * AppSync resource is a PIPELINE resolver whose Lambda-invocation
 * function uses a VTL request mapping template that emits a flat
 * payload:
 *
 *   {
 *     "operation": "Invoke",
 *     "payload": {
 *       "typeName": "Query",
 *       "fieldName": "listAdminUsers",
 *       "arguments": { ... },
 *       "identity": { ... },
 *       "source": ..., "request": ..., "prev": ...
 *     }
 *   }
 *
 * Notably this is NOT the canonical `AppSyncResolverEvent` shape
 * (which has `event.info.fieldName`). The `aws-lambda` package's
 * `AppSyncResolverHandler` type is misleading here — typing the
 * handler with it sends `event.info.fieldName` to `undefined` and
 * blows up at runtime with
 * `Cannot read properties of undefined (reading 'fieldName')`.
 */
interface UserAdminEvent {
  typeName: string
  fieldName: string
  arguments: Partial<SetArgs>
  // Cognito user token / IAM role context set by AppSync. When a Cognito
  // user calls via AppSync, identity is { sub, username, groups: [...], ... }.
  identity?: {
    sub?: string
    username?: string
    groups?: string[]
    [k: string]: unknown
  }
  source?: unknown
  request?: unknown
  prev?: unknown
}

/**
 * Belt-and-suspenders authorization. AppSync already gates listAdminUsers /
 * setAdminUserRole to the `ampless-admin` group at the schema level, but if
 * this Lambda is ever invoked directly (e.g. a misconfigured IAM policy that
 * bypasses AppSync) the re-check ensures only admins can list users or change
 * roles. Mirrors plugin-secret-handler.ts's isAllowedGroup pattern.
 */
function isAdmin(identity: UserAdminEvent['identity']): boolean {
  return (identity?.groups ?? []).includes(ADMIN_GROUP)
}

export const handler: Handler<UserAdminEvent, AdminUserDto | AdminUserDto[] | null> = async (
  event
) => {
  const userPoolId = requireUserPoolId()
  const field = event.fieldName

  try {
    if (!isAdmin(event.identity)) {
      console.error('[user-admin] caller is not in the ampless-admin group')
      throw new Error('Unauthorized: ampless-admin group required')
    }
    if (field === 'listAdminUsers') {
      return await listAdminUsers(userPoolId)
    }
    if (field === 'setAdminUserRole') {
      const { userId, role } = event.arguments as SetArgs
      if (role !== 'admin' && role !== 'editor' && role !== 'none') {
        console.error(`[user-admin] invalid role: ${role}`)
        throw new Error(`Invalid role: ${role}`)
      }
      if (!userId) {
        console.error('[user-admin] missing userId argument')
        throw new Error('Missing userId argument')
      }
      return await setAdminUserRole(userPoolId, userId, role)
    }
    console.error(`[user-admin] unsupported fieldName: ${field}`)
    throw new Error(`Unsupported fieldName: ${field}`)
  } catch (err) {
    console.error(`[user-admin] ${field} failed:`, err)
    throw err
  }
}
