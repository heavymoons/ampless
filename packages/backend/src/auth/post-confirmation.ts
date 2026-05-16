import type { PostConfirmationTriggerHandler } from 'aws-lambda'
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  ListUsersInGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider'

const cognito = new CognitoIdentityProviderClient({})

/**
 * Post-confirmation Cognito trigger: promote the first confirmed user
 * to `ampless-admin`. Subsequent signups stay in the default group
 * (i.e. no group) and the admin must promote them manually.
 *
 * Re-exported from the template's thin shell
 * `amplify/auth/post-confirmation/handler.ts`; Amplify's esbuild
 * bundles this module into the Lambda artifact.
 */
export const handler: PostConfirmationTriggerHandler = async (event) => {
  const { userPoolId, userName } = event

  const existing = await cognito.send(
    new ListUsersInGroupCommand({
      UserPoolId: userPoolId,
      GroupName: 'ampless-admin',
      Limit: 1,
    })
  )

  if (!existing.Users || existing.Users.length === 0) {
    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: userName,
        GroupName: 'ampless-admin',
      })
    )
  }

  return event
}
