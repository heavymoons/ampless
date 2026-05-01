# Runbook

Operational tasks for an ampless-powered site.

## Public reads use the Cognito Identity Pool guest role

Anonymous visitors (the public blog at `/`, `/{slug}`, `/tag/{tag}`,
`/feed.xml`, `/sitemap.xml`) hit AppSync via the Identity Pool's
unauthenticated role, configured by `defineAuth` in
`amplify/auth/resource.ts`. The `allow.guest()` rules on the custom
queries (`listPublishedPosts`, `getPublishedPost`, `listPostsByTag`) gate
which fields are reachable; the resolvers themselves filter on
`status === 'published'` so drafts are never visible.

There is **no AppSync API key** to rotate. This used to be the case in
v0.1's early Phase 4 builds — that path has been retired.

## Common operations

### Promote / demote a user

Use the AWS Cognito console:

1. User Pool → Users → pick the user
2. Group memberships → Add to / remove from group
3. Have the user sign out and back in for the new claims to apply

Groups: `ampless-admin` (full CRUD + ops), `ampless-editor` (content
CRUD), `ampless-reader` (reserved for future REST/MCP API consumers).

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
