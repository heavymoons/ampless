import { defineBackend } from '@aws-amplify/backend'
import { Effect, PolicyStatement, AnyPrincipal } from 'aws-cdk-lib/aws-iam'
import type { CfnBucket } from 'aws-cdk-lib/aws-s3'
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

// --- Storage: make `public/*` directly fetchable from the browser ---
// Two pieces are needed:
//   1. Relax S3 Block Public Access at the bucket level so the public-read
//      policy below is accepted (the default Amplify bucket has BPA on,
//      which would otherwise reject any allow-statement with `*` principal).
//   2. Attach a bucket policy granting `s3:GetObject` on `public/*` to
//      anyone. Combined, this lets uploaded media be served from a stable
//      `https://{bucket}.s3.{region}.amazonaws.com/public/...` URL — no
//      Lambda hop, no presign expiry.
const cfnBucket = backend.storage.resources.cfnResources.cfnBucket as CfnBucket
cfnBucket.publicAccessBlockConfiguration = {
  blockPublicAcls: true,
  blockPublicPolicy: false,
  ignorePublicAcls: true,
  restrictPublicBuckets: false,
}

backend.storage.resources.bucket.addToResourcePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    principals: [new AnyPrincipal()],
    actions: ['s3:GetObject'],
    resources: [`${backend.storage.resources.bucket.bucketArn}/public/*`],
  })
)

// --- Auth: post-confirmation Lambda permissions ---
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
