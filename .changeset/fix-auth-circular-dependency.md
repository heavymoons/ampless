---
"@ampless/backend": patch
---

Fix a CloudFormation circular dependency that broke `main` deploys (auth nested stack `UPDATE_FAILED`).

#216 scoped the post-confirmation Lambda's Cognito IAM policy to the user pool's own ARN (`userPool.userPoolArn`). Because that Lambda is a Cognito User Pool **trigger**, the pool already depends on the Lambda — adding the pool ARN to the Lambda's role policy created the reverse edge and a cycle: `UserPool → (trigger) Lambda → Lambda role policy → UserPool ARN`.

Both Cognito Lambda policies (post-confirmation and user-admin) are reverted to an account/region `userpool/*` wildcard, with comments explaining why the post-confirmation policy must stay wide and why the two are kept symmetric so the cycle can't be silently reintroduced. The Lambdas still operate on a single pool at runtime (trigger event `userPoolId` / `AMPLESS_USER_POOL_ID`).
