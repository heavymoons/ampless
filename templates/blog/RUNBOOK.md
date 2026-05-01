# Runbook

Operational tasks for an ampless-powered site.

## AppSync API key rotation

Public blog reads (`listPublishedPosts`, `getPublishedPost`,
`listPostsByTag`) are gated by an AppSync API key with a 365-day TTL.
The key lives in `amplify_outputs.json` and is therefore **visible to
anyone visiting the public site**. Treat it as a low-trust credential —
its only privilege is calling the three custom queries, which themselves
only return rows where `status === 'published'`.

### Why an API key (and not the Identity Pool guest role)?

Amplify Gen 2 `a.handler.custom` resolvers don't support `allow.guest()`
or `allow.authenticated('identityPool')` — only apiKey / userPool /
lambda / group / owner. Until that changes, the public read path needs
to be either an API key or a custom Lambda function data source. v0.1
chose the API key for simplicity; switching to a Lambda data source is
a v0.2 candidate when the operational cost of rotation outweighs the
runtime cost of cold starts.

### When to rotate

- **Routine**: at least 30 days before the key's `expiresInDays`
  deadline (configured in `amplify/data/resource.ts`). AppSync hard-
  rejects requests after expiry — missing the rotation = public site
  goes down.
- **Suspected leak**: immediately. (Note: rate-limit your AppSync API in
  CloudFront / WAF if you depend on this for cost control.)

### How to rotate

1. Bump the version of `amplify/data/resource.ts` (any change forces
   redeploy). For a no-op nudge, edit a comment and save.
2. Run a fresh deployment so Amplify regenerates the key:
   ```bash
   npx ampx sandbox        # local development
   npx ampx pipeline-deploy --branch <branch> --app-id <app-id>
   ```
3. Confirm the new key is in `amplify_outputs.json` (`data.api_key`) and
   redeploy the Next.js app so SSR picks up the new key.

### Reset the schedule

If you want a different TTL, edit `amplify/data/resource.ts`:

```ts
authorizationModes: {
  defaultAuthorizationMode: 'userPool',
  apiKeyAuthorizationMode: { expiresInDays: 365 }, // 7–365
},
```

Lower TTLs reduce blast radius on leak but require more frequent rotation.

## Common operations

### Promote / demote a user

Use the AWS Cognito console:

1. User Pool → Users → pick the user
2. Group memberships → Add to / remove from group
3. Have the user sign out and back in for the new claims to apply

Groups: `ampless-admin` (full CRUD + ops), `ampless-editor` (content
CRUD), `ampless-reader` (reserved for future REST/MCP API consumers).

### Reset a user's password (admin override)

If someone is locked out and email-based recovery isn't an option:

```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id <pool-id-from-amplify_outputs.json:auth.user_pool_id> \
  --region <region> \
  --username <email> \
  --password '<new-password>' --permanent
```

The `/login` page also has a self-service "Forgot password?" flow.

### Restore from a Post-table backup

DynamoDB Point-in-Time Recovery is **not** enabled by `defineData` in
v0.1; turn it on manually via AWS Console → DynamoDB → Tables →
`<your post table>` → Backups → Edit PITR. Once enabled, restoration
takes the form `aws dynamodb restore-table-to-point-in-time` to a new
table; you'll need to migrate items back to the live table afterwards.

### Inspect failed plugin events

Failed processor invocations land in the shared events DLQ created in
`amplify/backend.ts` (`EventsDlq`). View messages via the SQS console
or `aws sqs receive-message --queue-url <dlq-url> --max-number-of-messages 10`.
There's no automated alarm in v0.1 — periodic manual checks recommended,
or wire up a CloudWatch alarm on `ApproximateNumberOfMessagesVisible`.
