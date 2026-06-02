---
"@ampless/backend": patch
---

Scope post-confirmation and user-admin Lambda IAM policies to
the actual Cognito user pool ARN instead of
`arn:aws:cognito-idp:*:*:userpool/*`. Defense-in-depth: the
Lambdas read `AMPLESS_USER_POOL_ID` at runtime and address one
pool, but the wildcard would let a compromised Lambda (or a
handler bug) reach any user pool in the same AWS account.
Resolved via `backend.auth.resources.userPool.userPoolArn`.
