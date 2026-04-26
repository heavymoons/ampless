import { defineBackend } from '@aws-amplify/backend'
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { auth } from './auth/resource.js'
import { data } from './data/resource.js'
import { storage } from './storage/resource.js'
import { postConfirmation } from './auth/post-confirmation/resource.js'

const backend = defineBackend({
  auth,
  data,
  storage,
  postConfirmation,
})

// Grant post-confirmation Lambda permission to manage Cognito groups.
// We use a wildcard resource ARN to avoid a circular dependency between
// the auth, function, and data CloudFormation stacks. The trigger event
// payload includes the user pool ID, so the handler always operates on
// the correct pool at runtime.
backend.postConfirmation.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['cognito-idp:AdminAddUserToGroup', 'cognito-idp:ListUsersInGroup'],
    resources: ['arn:aws:cognito-idp:*:*:userpool/*'],
  })
)
