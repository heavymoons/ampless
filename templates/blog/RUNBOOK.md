# Runbook

Operational tasks for an ampless-powered site.

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

## Multi-site / custom domains

ampless can serve multiple sites from one Amplify Hosting deployment.
Each site is identified by a `siteId` and bound to one or more
hostnames via `cms.config.ts`:

```ts
sites: {
  blog: {
    domains: ['blog.example.com', 'www.example.com'],
    name: 'My Blog',
    url: 'https://blog.example.com',
  },
  docs: {
    domains: ['docs.example.com'],
    name: 'Docs',
    url: 'https://docs.example.com',
  },
},
```

The middleware (`middleware.ts`) maps incoming `Host` to a `siteId` and
internally rewrites the path to `/_sites/{siteId}/...`. Subdomains and
fully separate domains are equivalent at the application layer — only
the AWS-side wiring differs.

### Single domain operation

If `sites` is undefined or has only one entry, ampless runs in
single-site mode (`siteId='default'`). SSR responses follow each page's
own caching directives (so you can opt into CloudFront caching with
`Cache-Control: public, s-maxage=...` per route).

### Multi-site mode caveat: SSR caching is force-disabled

When two or more sites are declared, the middleware adds
`Cache-Control: private, no-store` to every public response. This is
because Amplify Hosting's CloudFront does not include `Host` in its
cache key — leaving caching on would let `https://site1/foo` and
`https://site2/foo` cross-contaminate at the edge. The trade-off is
that every public read hits Lambda. Lifting it requires moving off
Amplify Hosting onto a self-managed CloudFront + Open Next stack
(roadmap: post-v1.0).

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
5. Add the new domain to the matching `sites.{id}.domains[]` in
   `cms.config.ts` and redeploy:
   ```bash
   git add cms.config.ts && git commit -m "feat: add docs.example.com"
   git push   # Amplify Hosting picks it up
   ```

Verify end-to-end:

```bash
curl -I https://docs.example.com/                  # 200 with the docs site's HTML
curl -sI https://docs.example.com/ | grep -i cache # Cache-Control: private, no-store
```

If the request returns `404 Site not found` instead, the host is not
listed in any `sites.*.domains[]` — fix the config and redeploy.
