import type { PostConfirmationTriggerHandler } from 'aws-lambda'
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  ListUsersInGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider'

const cognito = new CognitoIdentityProviderClient({})

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
