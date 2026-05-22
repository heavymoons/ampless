> 日本語版: [RUNBOOK.ja.md](./RUNBOOK.ja.md)
> 

# Runbook

Step-by-step recipes for occasional operations on an ampless-powered site — the things you don't do every day but want a reliable procedure for when you do.

For day-to-day usage (commands, admin UI tour, themes, plugins, deploying), start with [README.md](./README.md).

## Contents

- [AppSync API key (auto-renewed)](#appsync-api-key-auto-renewed)
- [Common operations](#common-operations)
  - [Promote / demote a user](#promote--demote-a-user)
  - [Reset a user's password (admin override)](#reset-a-users-password-admin-override)
  - [Restore from a Post-table backup](#restore-from-a-post-table-backup)
  - [Inspect failed plugin events](#inspect-failed-plugin-events)
- [Custom domains](#custom-domains)
  - [Adding a custom domain to Amplify Hosting](#adding-a-custom-domain-to-amplify-hosting)

## AppSync API key (auto-renewed)

Public blog reads (`listPublishedPosts`, `getPublishedPost`,
`listPostsByTag`) are gated by an AppSync API key. The key lives in
`amplify_outputs.json` and is therefore **visible to anyone visiting
the public site** — treat it as a low-trust credential. Its only
privilege is calling the three custom queries, which themselves only
return rows where `status === 'published'`.

### Why an API key (and not the Identity Pool guest role)?

Amplify Gen 2 `a.handler.custom` resolvers don't support `allow.guest()`
or `allow.authenticated('identityPool')` — only apiKey / userPool /
lambda / group / owner. v0.1 chose API key for simplicity; switching
the public reads to a Lambda function data source (`a.handler.function`)
is a v0.2 candidate.

### Auto-renewal — no rotation runbook required

The `api-key-renewer` Lambda (see `amplify/functions/api-key-renewer/`)
is invoked by an EventBridge schedule on the 1st of every month at
03:00 UTC. It calls `AppSync.UpdateApiKey` to push `expires` to
"now + 364 days" on the existing key, so:

- the key id never changes,
- `amplify_outputs.json` stays valid,
- the Next.js app does not need to be rebuilt,
- at any moment, the key has at least ~334 days of remaining validity.

If you want to inspect or trigger it manually:

```bash
# verify current expiry
aws appsync list-api-keys \
  --region <region-from-amplify_outputs.json:data.aws_region> \
  --api-id <api-id-derived-from-amplify_outputs.json:data.url>

# manual run (e.g. after a long sandbox pause)
aws lambda invoke \
  --function-name $(aws lambda list-functions \
    --query "Functions[?contains(FunctionName,'api-key-renewer')].FunctionName | [0]" \
    --output text) \
  /tmp/out.json && cat /tmp/out.json
```

### If a key is suspected leaked

Immediate response is to rotate the key value (not just push expiry):

1. In `amplify/data/resource.ts`, edit a comment to force a CFN update
2. Run `npx ampx sandbox` (sandbox) or `npx ampx pipeline-deploy ...`
   (production) — Amplify regenerates the key value
3. Re-deploy the Next.js app so SSR picks up the new `data.api_key`

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

## Custom domains

ampless runs one site per Amplify deployment. To serve multiple sites
on different domains, deploy a separate Amplify environment per site.

### Adding a custom domain to Amplify Hosting

For each domain you want to bind:

1. **Amplify Hosting console** → your app → **Domain management** →
   **Add domain**.
2. Enter the apex domain (`example.com`) and the subdomains you want
   to attach. Amplify provisions an ACM certificate and a CloudFront
   SAN entry automatically.
3. Update DNS:
   - **Same DNS provider as Route 53 / Amplify managed**: Amplify
     creates the CNAMEs for you, just confirm.
   - **External DNS** (Cloudflare, Squarespace, etc.): Amplify shows
     CNAME / DNS verification records to copy. ACM email-validation
     also works as a fallback.
4. Wait for the **Domain activation** to finish (typically 15–60
   minutes; certificate validation is the slow step).
5. Update `cms.config.ts` so `site.url` reflects the new canonical URL,
   commit, and push to redeploy:
   ```bash
   git add cms.config.ts && git commit -m "feat: bind docs.example.com"
   git push   # Amplify Hosting picks it up
   ```

Verify end-to-end:

```bash
curl -I https://docs.example.com/   # 200 with your site's HTML
```
